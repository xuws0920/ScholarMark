import * as storage from '../modules/storage.js';

export const MEDIA_SCHEME = 'scholarmark-media://';
const IMAGE_BLOCK_DESC_PREFIX = '图片说明：';
const previewObjectUrls = new WeakMap();

export function extractMediaAssetIdsFromMarkdown(markdown) {
    const text = String(markdown || '');
    const ids = new Set();
    const escapedScheme = MEDIA_SCHEME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedScheme}([a-zA-Z0-9_-]+)`, 'g');
    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) ids.add(id);
    }
    return Array.from(ids);
}

export function buildImageBlockMarkdown({ src, title = '', description = '' }) {
    const safeTitle = String(title || '').trim() || '图片';
    const safeSrc = String(src || '').trim();
    const safeDescription = String(description || '').trim();
    const desc = safeDescription ? `${IMAGE_BLOCK_DESC_PREFIX}${safeDescription}` : IMAGE_BLOCK_DESC_PREFIX;
    return `![${safeTitle}](${safeSrc})\n\n*${desc}*`;
}

export async function createMediaAssetFromFile(pdfId, file) {
    if (!pdfId || !file) return null;
    const mimeType = String(file.type || 'application/octet-stream');
    return storage.addMediaAsset({
        pdfId,
        mimeType,
        blob: file,
        byteSize: Number(file.size) || 0
    });
}

export async function insertImageBlocksAtCursor({ textarea, pdfId, files }) {
    if (!textarea || !pdfId || !Array.isArray(files) || files.length === 0) {
        return { inserted: 0, assetIds: [] };
    }

    const blocks = [];
    const assetIds = [];
    for (const file of files) {
        if (!file || !String(file.type || '').startsWith('image/')) continue;
        const asset = await createMediaAssetFromFile(pdfId, file);
        if (!asset?.id) continue;
        assetIds.push(asset.id);
        const src = `${MEDIA_SCHEME}${asset.id}`;
        const title = inferImageTitle(file?.name);
        blocks.push(buildImageBlockMarkdown({ src, title }));
    }

    if (!blocks.length) {
        return { inserted: 0, assetIds: [] };
    }

    const text = `\n${blocks.join('\n\n')}\n`;
    insertTextAtCursor(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return { inserted: blocks.length, assetIds };
}

export function extractImageFilesFromClipboard(clipboardData) {
    const files = [];
    const items = Array.from(clipboardData?.items || []);
    for (const item of items) {
        if (!item || !String(item.type || '').startsWith('image/')) continue;
        const file = item.getAsFile();
        if (file) files.push(file);
    }
    return files;
}

export async function hydrateMediaImages(previewRoot, pdfId) {
    if (!previewRoot || !pdfId) return;
    releasePreviewObjectUrls(previewRoot);

    const urls = new Set();
    const imgNodes = previewRoot.querySelectorAll(`img[src^="${MEDIA_SCHEME}"]`);
    const tasks = Array.from(imgNodes).map(async (img) => {
        const rawSrc = String(img.getAttribute('src') || '');
        const assetId = rawSrc.slice(MEDIA_SCHEME.length).trim();
        if (!assetId) return;

        const asset = await storage.getMediaAsset(assetId);
        if (!asset || asset.pdfId !== pdfId || !asset.blob) {
            img.dataset.mediaMissing = '1';
            return;
        }

        const blobUrl = URL.createObjectURL(asset.blob);
        urls.add(blobUrl);
        img.src = blobUrl;
        img.dataset.mediaAssetId = assetId;
        img.dataset.mediaMissing = '';
    });
    await Promise.all(tasks);
    previewObjectUrls.set(previewRoot, urls);

    decorateImageBlocks(previewRoot);
}

function releasePreviewObjectUrls(previewRoot) {
    const urls = previewObjectUrls.get(previewRoot);
    if (!urls || typeof urls.forEach !== 'function') return;
    urls.forEach((url) => {
        try {
            URL.revokeObjectURL(url);
        } catch (_) {
            // no-op
        }
    });
    previewObjectUrls.delete(previewRoot);
}

function decorateImageBlocks(previewRoot) {
    const paragraphs = Array.from(previewRoot.querySelectorAll('p'));
    for (let i = 0; i < paragraphs.length; i += 1) {
        const p = paragraphs[i];
        if (!p || p.closest('figure.image-block')) continue;
        const img = extractStandaloneImage(p);
        if (!img) continue;

        const next = paragraphs[i + 1];
        const em = extractDescriptionEm(next);
        const description = em ? parseDescriptionText(em.textContent || '') : '';

        const figure = document.createElement('figure');
        figure.className = 'image-block';

        const imageWrap = document.createElement('div');
        imageWrap.className = 'image-block-image-wrap';
        imageWrap.appendChild(img.cloneNode(true));
        figure.appendChild(imageWrap);

        const caption = document.createElement('figcaption');
        caption.className = 'image-block-caption';

        const titleEl = document.createElement('div');
        titleEl.className = 'image-block-title';
        titleEl.textContent = (img.getAttribute('alt') || '').trim() || '图片';
        caption.appendChild(titleEl);

        const descEl = document.createElement('div');
        descEl.className = 'image-block-description';
        descEl.textContent = description;
        caption.appendChild(descEl);

        figure.appendChild(caption);
        p.replaceWith(figure);
        if (next && em) {
            next.remove();
            i += 1;
        }
    }
}

function extractStandaloneImage(paragraph) {
    if (!paragraph) return null;
    const children = Array.from(paragraph.childNodes);
    if (children.length !== 1) return null;
    const node = children[0];
    if (!(node instanceof HTMLImageElement)) return null;
    return node;
}

function extractDescriptionEm(paragraph) {
    if (!paragraph) return null;
    const children = Array.from(paragraph.childNodes);
    if (children.length !== 1) return null;
    const node = children[0];
    if (!(node instanceof HTMLElement)) return null;
    if (node.tagName !== 'EM') return null;
    return node;
}

function parseDescriptionText(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    if (text.startsWith(IMAGE_BLOCK_DESC_PREFIX)) {
        return text.slice(IMAGE_BLOCK_DESC_PREFIX.length).trim();
    }
    return text;
}

function inferImageTitle(fileName) {
    const name = String(fileName || '').trim();
    if (name) return name;
    const dt = new Date();
    const date = dt.toISOString().replace('T', ' ').slice(0, 19);
    return `粘贴图片 ${date}`;
}

function insertTextAtCursor(textarea, text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    textarea.value = before + text + after;
    const pos = start + text.length;
    textarea.selectionStart = pos;
    textarea.selectionEnd = pos;
}
