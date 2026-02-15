/**
 * outline.js — PDF 目录大纲模块
 * 
 * 提取 PDF 文档目录书签，渲染为可折叠的树形结构，支持点击跳转
 */

import { $ } from '../utils/dom.js';
import { getPdfDoc, goToPage } from './pdf-viewer.js';

let outlineData = null;
const MAX_OUTLINE_DEPTH = 2; // 0-based: 显示到第 3 层

/**
 * 初始化目录模块
 */
export function initOutline() {
    // Tab 切换事件
    const tabs = document.querySelectorAll('.sidebar-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.dataset.sidebarTab;
            // 切换面板显示
            $('#pdf-library-wrapper').style.display = target === 'library' ? 'flex' : 'none';
            $('#pdf-outline-panel').style.display = target === 'outline' ? 'flex' : 'none';
        });
    });
}

/**
 * 加载并渲染 PDF 目录
 */
export async function loadOutline() {
    const pdfDoc = getPdfDoc();
    const container = $('#pdf-outline-tree');

    if (!pdfDoc) {
        container.innerHTML = '<p class="outline-empty">请先打开 PDF 文献</p>';
        return;
    }

    container.innerHTML = '<p class="outline-loading">加载目录中...</p>';

    try {
        outlineData = await pdfDoc.getOutline();
        const filteredOutline = pruneOutlineByDepth(outlineData, 0);

        if (!filteredOutline || filteredOutline.length === 0) {
            container.innerHTML = '<p class="outline-empty">📄 此文档没有目录</p>';
            return;
        }

        container.innerHTML = '';
        const tree = await buildOutlineTree(filteredOutline, pdfDoc, 0);
        container.appendChild(tree);
    } catch (err) {
        console.error('加载目录失败:', err);
        container.innerHTML = '<p class="outline-empty">⚠️ 目录加载失败</p>';
    }
}

/**
 * 递归构建目录树
 */
async function buildOutlineTree(items, pdfDoc, depth) {
    const ul = document.createElement('ul');
    ul.className = depth === 0 ? 'outline-list outline-root' : 'outline-list outline-children';

    for (const item of items) {
        const li = document.createElement('li');
        li.className = 'outline-node';

        const hasChildren = item.items && item.items.length > 0;

        // 目录项行
        const row = document.createElement('div');
        row.className = 'outline-item';
        row.style.paddingLeft = (12 + depth * 16) + 'px';

        // 折叠箭头
        const arrow = document.createElement('span');
        arrow.className = 'outline-arrow';
        if (hasChildren) {
            arrow.textContent = '▶';
            arrow.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleChildren(li, arrow);
            });
        } else {
            arrow.textContent = ' ';
            arrow.style.visibility = 'hidden';
        }

        // 标题文本
        const title = document.createElement('span');
        title.className = 'outline-title';
        title.textContent = item.title;
        title.title = item.title;

        // 页码标签
        const pageLabel = document.createElement('span');
        pageLabel.className = 'outline-page';

        // 解析目标页码
        let pageNum = null;
        try {
            if (item.dest) {
                const dest = typeof item.dest === 'string'
                    ? await pdfDoc.getDestination(item.dest)
                    : item.dest;
                if (dest && dest[0]) {
                    const pageIndex = await pdfDoc.getPageIndex(dest[0]);
                    pageNum = pageIndex + 1;
                    pageLabel.textContent = `P${pageNum}`;
                }
            }
        } catch (e) {
            // 某些目录项可能无法解析页码，忽略
        }

        row.appendChild(arrow);
        row.appendChild(title);
        row.appendChild(pageLabel);

        // 点击跳转
        const targetPage = pageNum;
        row.addEventListener('click', () => {
            if (targetPage) {
                goToPage(targetPage);
                // 高亮当前选中的目录项
                document.querySelectorAll('.outline-item.active').forEach(el => el.classList.remove('active'));
                row.classList.add('active');
            }
        });

        li.appendChild(row);

        // 递归渲染子目录
        if (hasChildren) {
            const childTree = await buildOutlineTree(item.items, pdfDoc, depth + 1);
            childTree.style.display = 'none'; // 默认折叠
            li.appendChild(childTree);
        }

        ul.appendChild(li);
    }

    return ul;
}

/**
 * 折叠/展开子目录
 */
function toggleChildren(li, arrow) {
    const children = li.querySelector('.outline-children');
    if (!children) return;

    const isHidden = children.style.display === 'none';
    children.style.display = isHidden ? 'block' : 'none';
    arrow.textContent = isHidden ? '▼' : '▶';
    arrow.classList.toggle('expanded', isHidden);
}

/**
 * 清空目录
 */
function pruneOutlineByDepth(items, depth) {
    if (!Array.isArray(items) || items.length === 0) return [];
    if (depth > MAX_OUTLINE_DEPTH) return [];

    return items.map((item) => {
        const nextItems = item.items && item.items.length > 0
            ? pruneOutlineByDepth(item.items, depth + 1)
            : [];
        return { ...item, items: nextItems };
    });
}

export function clearOutline() {
    const container = $('#pdf-outline-tree');
    if (container) {
        container.innerHTML = '<p class="outline-empty">请先打开 PDF 文献</p>';
    }
    outlineData = null;
}
