import { renderMarkdown } from './markdown.js';
let lastExportErrorMessage = '';

/**
 * Use File System Access API to choose directory.
 */
export async function chooseDirectory() {
    if (!('showDirectoryPicker' in window)) {
        alert('您的浏览器不支持目录选择功能，请使用 Chrome 或 Edge 浏览器。');
        return null;
    }
    try {
        return await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('选择目录失败:', e);
        }
        return null;
    }
}

/**
 * Export markdown + rendered pdf (from markdown preview HTML) to selected directory.
 */
export async function exportNoteToDir(dirHandle, pdfName, noteTitle, content) {
    lastExportErrorMessage = '';
    try {
        const folderName = sanitizeFileName(String(pdfName || 'unknown').replace('.pdf', ''));
        const subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

        const baseName = sanitizeFileName(noteTitle || '未命名');

        const mdHandle = await subDir.getFileHandle(`${baseName}.md`, { create: true });
        const mdWritable = await mdHandle.createWritable();
        await mdWritable.write(content || '');
        await mdWritable.close();

        const pdfBytes = await markdownPreviewToPdfBytes(content || '');
        const pdfHandle = await subDir.getFileHandle(`${baseName}.pdf`, { create: true });
        const pdfWritable = await pdfHandle.createWritable();
        await pdfWritable.write(pdfBytes);
        await pdfWritable.close();

        return true;
    } catch (e) {
        lastExportErrorMessage = e?.message || String(e) || '未知导出错误';
        console.error('导出失败:', e);
        return false;
    }
}

/**
 * Download markdown + rendered pdf.
 */
export async function downloadNote(noteTitle, content) {
    const baseName = sanitizeFileName(noteTitle || '未命名');

    const mdBlob = new Blob([content || ''], { type: 'text/markdown;charset=utf-8' });
    triggerDownload(mdBlob, `${baseName}.md`);

    try {
        const pdfBytes = await markdownPreviewToPdfBytes(content || '');
        const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
        triggerDownload(pdfBlob, `${baseName}.pdf`);
    } catch (err) {
        console.warn('PDF download failed:', err);
    }
}

export function getLastExportError() {
    return lastExportErrorMessage || '';
}

/**
 * Batch export all notes (md + rendered pdf)
 */
export async function exportAllNotes(dirHandle, pdfName, notes) {
    let successCount = 0;
    for (const note of notes) {
        const ok = await exportNoteToDir(dirHandle, pdfName, note.title, note.content);
        if (ok) successCount++;
    }
    return successCount;
}

function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function sanitizeFileName(name) {
    return String(name || '').replace(/[<>:"/\\|?*]/g, '_').trim() || '未命名';
}

function base64ToBytes(base64) {
    const bin = atob(base64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function asciiBytes(text) {
    return new TextEncoder().encode(text);
}

function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

function buildPdfFromJpegPages(pages) {
    const objects = [];

    const addObject = (bytes) => {
        objects.push(bytes);
        return objects.length;
    };

    const pageRefIds = [];

    const catalogId = addObject(asciiBytes(''));
    const pagesId = addObject(asciiBytes(''));

    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const imgName = `Im${i + 1}`;

        const imgHeader = asciiBytes(`<< /Type /XObject /Subtype /Image /Width ${page.pxWidth} /Height ${page.pxHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
        const imgFooter = asciiBytes('\nendstream');
        const imgObjId = addObject(concatBytes([imgHeader, page.jpeg, imgFooter]));

        const contentStream = `q\n595 0 0 842 0 0 cm\n/${imgName} Do\nQ\n`;
        const contentObj = asciiBytes(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`);
        const contentObjId = addObject(contentObj);

        const pageObj = asciiBytes(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /ProcSet [/PDF /ImageC] /XObject << /${imgName} ${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`);
        const pageObjId = addObject(pageObj);
        pageRefIds.push(pageObjId);
    }

    objects[catalogId - 1] = asciiBytes(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    objects[pagesId - 1] = asciiBytes(`<< /Type /Pages /Count ${pageRefIds.length} /Kids [${pageRefIds.map((id) => `${id} 0 R`).join(' ')}] >>`);

    const header = asciiBytes('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
    const bodyParts = [header];
    const xrefOffsets = [0];

    let cursor = header.length;
    for (let i = 0; i < objects.length; i++) {
        const prefix = asciiBytes(`${i + 1} 0 obj\n`);
        const suffix = asciiBytes('\nendobj\n');
        const chunk = concatBytes([prefix, objects[i], suffix]);
        xrefOffsets.push(cursor);
        bodyParts.push(chunk);
        cursor += chunk.length;
    }

    const xrefStart = cursor;
    let xref = `xref\n0 ${objects.length + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (let i = 1; i < xrefOffsets.length; i++) {
        xref += `${String(xrefOffsets[i]).padStart(10, '0')} 00000 n \n`;
    }

    const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    bodyParts.push(asciiBytes(xref));
    bodyParts.push(asciiBytes(trailer));

    return concatBytes(bodyParts);
}

async function markdownPreviewToPdfBytes(markdownText) {
    const width = 1240;
    const pageHeight = 1754;
    try {
        const fullCanvas = await renderMarkdownToCanvas(markdownText || '', width, pageHeight);
        const pages = sliceCanvasToPages(fullCanvas, width, pageHeight);
        return buildPdfFromJpegPages(pages);
    } catch (err) {
        console.warn('Primary rendered export failed, fallback to safe renderer:', err);
        const safeCanvas = renderStructuredFallbackCanvas(markdownText || '', width, pageHeight);
        const safePages = sliceCanvasToPages(safeCanvas, width, pageHeight);
        return buildPdfFromJpegPages(safePages);
    }
}

async function renderMarkdownToCanvas(markdownText, width, minHeight) {
    const html = sanitizeRenderedHtml(renderMarkdown(markdownText || '') || '<p></p>');

    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-100000px';
    host.style.top = '0';
    host.style.width = `${width}px`;
    host.style.background = '#ffffff';
    host.style.color = '#111111';
    host.style.padding = '40px 52px';
    host.style.boxSizing = 'border-box';
    host.style.zIndex = '-1';

    host.innerHTML = `
      <style>
        .md-export-root { font-family: "Noto Sans SC","Microsoft YaHei","Segoe UI",sans-serif; font-size: 22px; line-height: 1.65; color: #111; }
        .md-export-root h1 { font-size: 38px; margin: 0 0 16px; }
        .md-export-root h2 { font-size: 31px; margin: 20px 0 12px; }
        .md-export-root h3 { font-size: 27px; margin: 16px 0 10px; }
        .md-export-root p { margin: 10px 0; white-space: pre-wrap; word-break: break-word; }
        .md-export-root ul, .md-export-root ol { margin: 8px 0 8px 24px; }
        .md-export-root li { margin: 4px 0; }
        .md-export-root blockquote { margin: 10px 0; padding: 8px 12px; border-left: 4px solid #d0d7e2; background: #f8fafc; }
        .md-export-root code { font-family: "JetBrains Mono","Consolas",monospace; background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
        .md-export-root pre { background: #f3f4f6; padding: 10px; border-radius: 6px; overflow: hidden; }
        .md-export-root pre code { background: transparent; padding: 0; }
        .md-export-root table { border-collapse: collapse; width: 100%; margin: 10px 0; }
        .md-export-root th, .md-export-root td { border: 1px solid #d1d5db; padding: 6px 8px; }
        .md-export-root img { max-width: 100%; }
      </style>
      <article class="md-export-root">${html}</article>
    `;

    document.body.appendChild(host);
    await waitFrame();
    await waitFrame();

    const height = Math.max(minHeight, host.scrollHeight + 12);
    const clone = host.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    const serialized = sanitizeXmlContent(new XMLSerializer().serializeToString(clone));

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject x="0" y="0" width="100%" height="100%">${serialized}</foreignObject>
    </svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    try {
        const img = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        return canvas;
    } finally {
        URL.revokeObjectURL(url);
        document.body.removeChild(host);
    }
}

function sliceCanvasToPages(fullCanvas, width, pageHeight) {
    const pages = [];
    let y = 0;
    while (y < fullCanvas.height || pages.length === 0) {
        const out = document.createElement('canvas');
        out.width = width;
        out.height = pageHeight;
        const ctx = out.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, pageHeight);

        const clipH = Math.min(pageHeight, fullCanvas.height - y);
        if (clipH > 0) {
            ctx.drawImage(fullCanvas, 0, y, width, clipH, 0, 0, width, clipH);
        }

        const dataUrl = out.toDataURL('image/jpeg', 0.92);
        pages.push({
            jpeg: base64ToBytes(dataUrl.split(',')[1] || ''),
            pxWidth: width,
            pxHeight: pageHeight
        });

        y += pageHeight;
    }
    return pages;
}

function sanitizeXmlContent(xml) {
    return String(xml || '').replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '');
}

function sanitizeRenderedHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = String(html || '');
    container.querySelectorAll('img,video,audio,iframe,object,embed,canvas,svg').forEach((node) => {
        const hint = document.createElement('span');
        hint.textContent = node.tagName === 'IMG' ? '[image omitted in export]' : '[media omitted in export]';
        hint.style.color = '#6b7280';
        node.replaceWith(hint);
    });
    container.querySelectorAll('*').forEach((el) => {
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            const value = String(attr.value || '');
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }
            if ((name === 'src' || name === 'href' || name === 'xlink:href') && /^https?:/i.test(value)) {
                el.removeAttribute(attr.name);
            }
        }
    });
    return container.innerHTML;
}

function waitFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function renderStructuredFallbackCanvas(markdownText, width, minHeight) {
    const marginX = 72;
    const marginTop = 64;
    const lineGap = 10;
    const maxTextWidth = width - marginX * 2;
    const blocks = toStructuredBlocks(markdownText || '');

    const probe = document.createElement('canvas');
    const pctx = probe.getContext('2d');
    if (!pctx) throw new Error('Canvas context unavailable');

    let totalHeight = marginTop;
    for (const block of blocks) {
        totalHeight += measureBlockHeight(pctx, block, maxTextWidth, lineGap) + 12;
    }
    totalHeight += marginTop;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.max(minHeight, totalHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let y = marginTop;
    for (const block of blocks) {
        y = drawBlock(ctx, block, marginX, y, maxTextWidth, lineGap) + 12;
    }
    return canvas;
}

function toStructuredBlocks(markdownText) {
    const lines = String(markdownText || '').replace(/\r/g, '').split('\n');
    const blocks = [];
    let inCode = false;
    let codeLang = '';
    let codeBuffer = [];

    const pushCode = () => {
        blocks.push({ type: 'code', lang: codeLang, text: codeBuffer.join('\n') });
        codeBuffer = [];
        codeLang = '';
    };

    for (const rawLine of lines) {
        const line = rawLine || '';
        if (line.trim().startsWith('```')) {
            if (!inCode) {
                inCode = true;
                codeLang = line.trim().slice(3).trim();
            } else {
                inCode = false;
                pushCode();
            }
            continue;
        }
        if (inCode) {
            codeBuffer.push(line);
            continue;
        }

        if (/^\s*#{1,3}\s+/.test(line)) {
            const level = (line.match(/^\s*(#{1,3})\s+/) || [,'#'])[1].length;
            blocks.push({ type: 'heading', level, text: line.replace(/^\s*#{1,3}\s+/, '') });
            continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
            blocks.push({ type: 'list', ordered: false, text: line.replace(/^\s*[-*]\s+/, '') });
            continue;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
            const m = line.match(/^\s*(\d+)\.\s+(.*)$/);
            blocks.push({ type: 'list', ordered: true, index: m ? m[1] : '1', text: m ? m[2] : line });
            continue;
        }
        if (/^\s*>\s?/.test(line)) {
            blocks.push({ type: 'quote', text: line.replace(/^\s*>\s?/, '') });
            continue;
        }
        if (!line.trim()) {
            blocks.push({ type: 'space' });
            continue;
        }
        blocks.push({ type: 'paragraph', text: line });
    }

    if (inCode && codeBuffer.length) {
        pushCode();
    }
    return blocks;
}

function measureBlockHeight(ctx, block, maxWidth, gap) {
    if (block.type === 'space') return 12;
    const style = blockStyle(block);
    ctx.font = style.font;
    const text = blockText(block);
    const lines = wrapText(ctx, text, Math.max(60, maxWidth - style.leftPad));
    const h = lines.length * style.lineHeight + Math.max(0, lines.length - 1) * gap;
    return Math.max(style.minHeight, h + style.verticalPad * 2);
}

function drawBlock(ctx, block, x, y, maxWidth, gap) {
    if (block.type === 'space') return y + 12;
    const style = blockStyle(block);
    const text = blockText(block);
    ctx.font = style.font;
    const lines = wrapText(ctx, text, Math.max(60, maxWidth - style.leftPad));
    const blockHeight = measureBlockHeight(ctx, block, maxWidth, gap);

    if (style.bg) {
        ctx.fillStyle = style.bg;
        ctx.fillRect(x, y, maxWidth, blockHeight);
    }
    if (style.borderLeft) {
        ctx.fillStyle = style.borderLeft;
        ctx.fillRect(x, y, 6, blockHeight);
    }

    ctx.fillStyle = style.color;
    ctx.textBaseline = 'top';

    let drawY = y + style.verticalPad;
    const drawX = x + style.leftPad;
    for (const line of lines) {
        ctx.fillText(line, drawX, drawY);
        drawY += style.lineHeight + gap;
    }
    return y + blockHeight;
}

function blockStyle(block) {
    if (block.type === 'heading') {
        if (block.level === 1) return { font: '700 52px "Noto Sans SC","Microsoft YaHei",sans-serif', lineHeight: 62, color: '#111', leftPad: 0, verticalPad: 4, minHeight: 62 };
        if (block.level === 2) return { font: '700 42px "Noto Sans SC","Microsoft YaHei",sans-serif', lineHeight: 52, color: '#111', leftPad: 0, verticalPad: 2, minHeight: 52 };
        return { font: '700 34px "Noto Sans SC","Microsoft YaHei",sans-serif', lineHeight: 44, color: '#111', leftPad: 0, verticalPad: 2, minHeight: 44 };
    }
    if (block.type === 'code') {
        return { font: '500 24px "Consolas","Courier New",monospace', lineHeight: 34, color: '#111', leftPad: 16, verticalPad: 14, minHeight: 40, bg: '#f3f4f6' };
    }
    if (block.type === 'quote') {
        return { font: '400 28px "Noto Sans SC","Microsoft YaHei",sans-serif', lineHeight: 38, color: '#333', leftPad: 20, verticalPad: 12, minHeight: 38, bg: '#f8fafc', borderLeft: '#d0d7e2' };
    }
    if (block.type === 'list') {
        return { font: '400 28px "Noto Sans SC","Microsoft YaHei",sans-serif', lineHeight: 38, color: '#111', leftPad: 12, verticalPad: 0, minHeight: 38 };
    }
    return { font: '400 28px "Noto Sans SC","Microsoft YaHei",sans-serif', lineHeight: 40, color: '#111', leftPad: 0, verticalPad: 0, minHeight: 40 };
}

function blockText(block) {
    const text = stripInlineMd(block.text || '');
    if (block.type === 'list') {
        return block.ordered ? `${block.index || '1'}. ${text}` : `• ${text}`;
    }
    return text;
}

function stripInlineMd(text) {
    return String(text || '')
        .replace(/!\[[^\]]*]\([^)]*\)/g, '[image]')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/~~([^~]+)~~/g, '$1')
        .trim();
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const source = String(text || '');
    if (!source) return [''];
    for (const raw of source.split('\n')) {
        if (!raw) {
            lines.push('');
            continue;
        }
        let buf = '';
        for (const ch of raw) {
            const next = buf + ch;
            if (!buf || ctx.measureText(next).width <= maxWidth) {
                buf = next;
            } else {
                lines.push(buf);
                buf = ch;
            }
        }
        lines.push(buf);
    }
    return lines.length ? lines : [''];
}
