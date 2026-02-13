/**
 * search.js — 搜索模块
 * 
 * 搜索标注和笔记内容，展示搜索结果
 */

import { $, createElement, debounce, truncateText } from '../utils/dom.js';
import * as storage from './storage.js';

// 回调
let onAnnotationResultClick = null;
let onNoteResultClick = null;

/**
 * 初始化搜索模块
 */
export function initSearch(callbacks = {}) {
    onAnnotationResultClick = callbacks.onAnnotationResultClick;
    onNoteResultClick = callbacks.onNoteResultClick;

    const input = $('#search-input');
    const clearBtn = $('#btn-clear-search');
    const resultsContainer = $('#search-results');
    const libraryContainer = $('#pdf-library');

    input.addEventListener('input', debounce(async () => {
        const query = input.value.trim();

        if (!query) {
            clearSearch();
            return;
        }

        clearBtn.style.display = 'block';
        resultsContainer.style.display = 'block';
        libraryContainer.style.display = 'none';

        await performSearch(query);
    }, 300));

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearSearch();
        input.focus();
    });
}

/**
 * 清除搜索
 */
function clearSearch() {
    $('#btn-clear-search').style.display = 'none';
    $('#search-results').style.display = 'none';
    $('#search-results').innerHTML = '';
    $('#pdf-library').style.display = 'flex';
}

/**
 * 执行搜索
 */
async function performSearch(query) {
    const results = await storage.searchAll(query);
    const container = $('#search-results');
    container.innerHTML = '';

    const totalResults = results.annotations.length + results.notes.length;

    if (totalResults === 0) {
        container.innerHTML = '<p class="empty-hint">没有找到匹配结果</p>';
        return;
    }

    // 获取 PDF 名称映射
    const pdfs = await storage.getAllPdfs();
    const pdfNameMap = {};
    pdfs.forEach(p => pdfNameMap[p.id] = p.name);

    // 标注结果
    if (results.annotations.length > 0) {
        const group = createElement('div', { className: 'search-group' });
        group.appendChild(createElement('div', {
            className: 'search-group-title',
            textContent: `📌 标注 (${results.annotations.length})`
        }));

        for (const ann of results.annotations) {
            const item = createElement('div', {
                className: 'search-result-item',
                onClick: () => {
                    if (onAnnotationResultClick) onAnnotationResultClick(ann);
                }
            }, [
                createElement('div', {
                    className: 'search-result-color',
                    style: { backgroundColor: ann.color }
                }),
                createElement('div', { className: 'search-result-content' }, [
                    createElement('div', {
                        className: 'search-result-text',
                        innerHTML: highlightQuery(truncateText(ann.text, 100), query)
                    }),
                    createElement('div', {
                        className: 'search-result-meta',
                        textContent: `${pdfNameMap[ann.pdfId] || '未知文献'} · 第 ${ann.page} 页`
                    })
                ])
            ]);
            group.appendChild(item);
        }
        container.appendChild(group);
    }

    // 笔记结果
    if (results.notes.length > 0) {
        const group = createElement('div', { className: 'search-group' });
        group.appendChild(createElement('div', {
            className: 'search-group-title',
            textContent: `📝 笔记 (${results.notes.length})`
        }));

        for (const note of results.notes) {
            // 在内容中找到匹配的上下文
            const context = getMatchContext(note.content, query);

            const item = createElement('div', {
                className: 'search-result-item',
                onClick: () => {
                    if (onNoteResultClick) onNoteResultClick(note);
                }
            }, [
                createElement('div', {
                    className: 'search-result-color',
                    style: { backgroundColor: 'var(--accent-primary)' }
                }),
                createElement('div', { className: 'search-result-content' }, [
                    createElement('div', {
                        className: 'search-result-text',
                        innerHTML: `<strong>${note.title}</strong><br>${highlightQuery(context, query)}`
                    }),
                    createElement('div', {
                        className: 'search-result-meta',
                        textContent: pdfNameMap[note.pdfId] || '未知文献'
                    })
                ])
            ]);
            group.appendChild(item);
        }
        container.appendChild(group);
    }
}

/**
 * 高亮搜索词
 */
function highlightQuery(text, query) {
    if (!text || !query) return text;
    const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    return text.replace(regex, '<mark style="background:var(--highlight-yellow);color:#000;border-radius:2px;padding:0 2px;">$1</mark>');
}

/**
 * 获取匹配上下文
 */
function getMatchContext(content, query, contextLen = 60) {
    if (!content) return '';
    const lower = content.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return truncateText(content, 100);

    const start = Math.max(0, idx - contextLen);
    const end = Math.min(content.length, idx + query.length + contextLen);
    let context = content.substring(start, end);
    if (start > 0) context = '...' + context;
    if (end < content.length) context = context + '...';
    return context;
}

function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
