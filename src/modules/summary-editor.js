/**
 * summary-editor.js - literature summary editor
 */

import { $, debounce } from '../utils/dom.js';
import { renderMarkdown } from '../utils/markdown.js';
import { markSaved, markSaveError } from '../utils/save-status.js';
import * as storage from './storage.js';

let currentPdfId = null;
let currentSummary = null;

export function initSummaryEditor() {
    const tabBtns = document.querySelectorAll('#summary-tab-bar .summary-tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('#workspace-summary .summary-tab-panel').forEach(p => p.classList.remove('active'));
            $(`#summary-tab-${btn.dataset.summaryTab}`)?.classList.add('active');

            if (btn.dataset.summaryTab === 'preview') {
                updatePreview();
            }
        });
    });

    const editor = $('#summary-editor');
    editor?.addEventListener('input', debounce(async () => {
        if (!currentSummary) return;
        currentSummary.content = editor.value;
        try {
            await storage.updateSummary(currentSummary);
            markSaved('总结', '已保存');
        } catch (err) {
            console.warn(err);
            markSaveError('总结', '保存失败');
        }
    }, 500));

    $('#btn-reset-summary')?.addEventListener('click', async () => {
        if (!currentSummary) return;
        if (!confirm('确定重置为默认总结模板吗？')) return;

        currentSummary.content = getDefaultSummaryTemplate();
        $('#summary-editor').value = currentSummary.content;
        await storage.updateSummary(currentSummary);
        markSaved('总结', '已保存');
        updatePreview();
    });
}

export async function setPdfId(pdfId) {
    currentPdfId = pdfId;
    if (!pdfId) {
        clearSummaryView();
        return;
    }

    let summary = await storage.getSummaryByPdf(pdfId);
    if (!summary) {
        summary = await storage.addSummary({
            pdfId,
            title: '文献总结',
            content: getDefaultSummaryTemplate()
        });
    }

    currentSummary = summary;
    $('#summary-editor').value = summary.content || '';
    updatePreview();
}

export function clearSummaryView() {
    currentSummary = null;
    const editor = $('#summary-editor');
    const preview = $('#summary-preview');
    if (editor) editor.value = '';
    if (preview) preview.innerHTML = '<p class="empty-hint">请先打开 PDF 文献</p>';
}

export function getCurrentSummary() {
    return currentSummary;
}

export async function appendToSummary(content, heading = '## AI 翻译片段') {
    if (!currentSummary) return false;
    const extra = (content || '').trim();
    if (!extra) return false;

    const original = ($('#summary-editor')?.value || currentSummary.content || '').trimEnd();
    const merged = [original, '', heading, '', extra, ''].join('\n');
    currentSummary.content = merged;
    $('#summary-editor').value = merged;
    await storage.updateSummary(currentSummary);
    markSaved('总结', '已保存');
    updatePreview();
    return true;
}

function updatePreview() {
    const preview = $('#summary-preview');
    const content = $('#summary-editor')?.value || '';
    preview.innerHTML = renderMarkdown(content) || '<p class="empty-hint">暂无内容</p>';
    recoverInvisibleMath(preview);
}

function getDefaultSummaryTemplate() {
    return `# 文献总结

## 研究内容

- 

## 研究方法

- 

## 研究结果

- 

## 讨论

- `;
}

function recoverInvisibleMath(previewRoot) {
    const tokens = previewRoot.querySelectorAll('.math-token');
    tokens.forEach((token) => {
        const katexNode = token.querySelector('.katex');
        if (!katexNode) return;

        const style = window.getComputedStyle(katexNode);
        const hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
        const collapsed = katexNode.offsetWidth === 0 || katexNode.offsetHeight === 0;

        if (hidden || collapsed) {
            token.textContent = token.dataset.raw || '';
            token.classList.add('math-token-fallback');
        }
    });
}
