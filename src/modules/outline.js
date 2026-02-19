import { $ } from '../utils/dom.js';
import { getPdfDoc, goToPage } from './pdf-viewer.js';

let outlineData = null;
const MAX_OUTLINE_DEPTH = 2;
let heightRaf = 0;

export function initOutline() {
    bindSidebarTabs();
    bindOutlineDrawer();
    window.addEventListener('resize', scheduleOutlineDrawerHeightUpdate);
}

function bindSidebarTabs() {
    const tabs = document.querySelectorAll('.sidebar-tab');
    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            tabs.forEach((t) => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.dataset.sidebarTab;
            const library = $('#pdf-library-wrapper');
            if (library) {
                library.style.display = target === 'library' ? 'flex' : 'none';
            }

            if (typeof window !== 'undefined' && typeof window._onSidebarTabChange === 'function') {
                window._onSidebarTabChange(target);
            }
        });
    });
}

function bindOutlineDrawer() {
    $('#btn-toggle-pdf-outline')?.addEventListener('click', () => {
        toggleOutlineDrawer();
    });

    $('#btn-close-pdf-outline')?.addEventListener('click', () => {
        closeOutlineDrawer();
    });
}

function toggleOutlineDrawer() {
    const drawer = $('#pdf-outline-drawer');
    const btn = $('#btn-toggle-pdf-outline');
    if (!drawer || !btn) return;

    const opening = !drawer.classList.contains('open');
    drawer.classList.toggle('open', opening);
    drawer.setAttribute('aria-hidden', opening ? 'false' : 'true');
    btn.classList.toggle('active', opening);
    btn.title = opening ? '关闭文献目录' : '文献目录';

    if (opening) {
        scheduleOutlineDrawerHeightUpdate();
    } else {
        drawer.style.height = '';
    }
}

function closeOutlineDrawer() {
    const drawer = $('#pdf-outline-drawer');
    const btn = $('#btn-toggle-pdf-outline');
    if (!drawer) return;

    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.style.height = '';

    btn?.classList.remove('active');
    if (btn) btn.title = '文献目录';
}

export async function loadOutline() {
    const pdfDoc = getPdfDoc();
    const container = $('#pdf-outline-tree');
    if (!container) return;

    if (!pdfDoc) {
        container.innerHTML = '<p class="outline-empty">请先打开 PDF 文献</p>';
        scheduleOutlineDrawerHeightUpdate();
        return;
    }

    container.innerHTML = '<p class="outline-loading">加载目录中...</p>';
    scheduleOutlineDrawerHeightUpdate();

    try {
        outlineData = await pdfDoc.getOutline();
        const filteredOutline = pruneOutlineByDepth(outlineData, 0);

        if (!filteredOutline || filteredOutline.length === 0) {
            container.innerHTML = '<p class="outline-empty">此文档没有目录</p>';
            scheduleOutlineDrawerHeightUpdate();
            return;
        }

        container.innerHTML = '';
        const tree = await buildOutlineTree(filteredOutline, pdfDoc, 0);
        container.appendChild(tree);
        scheduleOutlineDrawerHeightUpdate();
    } catch (err) {
        console.error('加载目录失败:', err);
        container.innerHTML = '<p class="outline-empty">目录加载失败</p>';
        scheduleOutlineDrawerHeightUpdate();
    }
}

async function buildOutlineTree(items, pdfDoc, depth) {
    const ul = document.createElement('ul');
    ul.className = depth === 0 ? 'outline-list outline-root' : 'outline-list outline-children';

    for (const item of items) {
        const li = document.createElement('li');
        li.className = 'outline-node';

        const hasChildren = item.items && item.items.length > 0;

        const row = document.createElement('div');
        row.className = 'outline-item';
        row.style.paddingLeft = `${12 + depth * 16}px`;

        const arrow = document.createElement('span');
        arrow.className = 'outline-arrow';
        if (hasChildren) {
            arrow.textContent = '?';
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleChildren(li, arrow);
            });
        } else {
            arrow.textContent = ' ';
            arrow.style.visibility = 'hidden';
        }

        const title = document.createElement('span');
        title.className = 'outline-title';
        title.textContent = item.title || '未命名章节';
        title.title = item.title || '未命名章节';

        const pageLabel = document.createElement('span');
        pageLabel.className = 'outline-page';

        let pageNum = null;
        try {
            if (item.dest) {
                const dest = typeof item.dest === 'string' ? await pdfDoc.getDestination(item.dest) : item.dest;
                if (dest && dest[0]) {
                    const pageIndex = await pdfDoc.getPageIndex(dest[0]);
                    pageNum = pageIndex + 1;
                    pageLabel.textContent = `P${pageNum}`;
                }
            }
        } catch (_) {
            pageNum = null;
        }

        row.appendChild(arrow);
        row.appendChild(title);
        row.appendChild(pageLabel);

        row.addEventListener('click', () => {
            if (!pageNum) return;
            goToPage(pageNum);
            document.querySelectorAll('.outline-item.active').forEach((el) => el.classList.remove('active'));
            row.classList.add('active');
        });

        li.appendChild(row);

        if (hasChildren) {
            const childTree = await buildOutlineTree(item.items, pdfDoc, depth + 1);
            childTree.style.display = 'none';
            li.appendChild(childTree);
        }

        ul.appendChild(li);
    }

    return ul;
}

function toggleChildren(li, arrow) {
    const children = li.querySelector('.outline-children');
    if (!children) return;

    const isHidden = children.style.display === 'none';
    children.style.display = isHidden ? 'block' : 'none';
    arrow.textContent = isHidden ? '▼' : '?';
    arrow.classList.toggle('expanded', isHidden);
    scheduleOutlineDrawerHeightUpdate();
}

function pruneOutlineByDepth(items, depth) {
    if (!Array.isArray(items) || items.length === 0) return [];
    if (depth > MAX_OUTLINE_DEPTH) return [];

    return items.map((item) => {
        const nextItems = item.items && item.items.length > 0 ? pruneOutlineByDepth(item.items, depth + 1) : [];
        return { ...item, items: nextItems };
    });
}

export function clearOutline() {
    const container = $('#pdf-outline-tree');
    if (container) {
        container.innerHTML = '<p class="outline-empty">请先打开 PDF 文献</p>';
    }
    closeOutlineDrawer();
    outlineData = null;
}

function scheduleOutlineDrawerHeightUpdate() {
    if (heightRaf) {
        cancelAnimationFrame(heightRaf);
    }
    heightRaf = requestAnimationFrame(() => {
        heightRaf = 0;
        updateOutlineDrawerHeight();
    });
}

function updateOutlineDrawerHeight() {
    const drawer = $('#pdf-outline-drawer');
    const header = drawer?.querySelector('.pdf-outline-drawer-header');
    const content = $('#pdf-outline-tree');
    if (!drawer || !header || !content || !drawer.classList.contains('open')) return;

    const contentHeight = content.scrollHeight || 0;
    const headerHeight = header.getBoundingClientRect().height || 44;
    const borderPadding = 14;
    const desired = headerHeight + contentHeight + borderPadding;
    const max = Math.max(220, (window.innerHeight || 900) - 90);
    const min = 180;
    const finalHeight = Math.max(min, Math.min(max, desired));
    drawer.style.height = `${finalHeight}px`;
}
