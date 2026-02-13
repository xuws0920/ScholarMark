/**
 * annotator.js — 文本标注模块
 * 
 * 处理文本选中、颜色标注、标注持久化和关联跳转
 */

import { $, createElement } from '../utils/dom.js';
import * as storage from './storage.js';
import { addHighlightToPage, clearHighlightsOnPage, clearAllHighlights, goToPage, flashAnnotation } from './pdf-viewer.js';

let currentPdfId = null;
let annotations = []; // 当前 PDF 的所有标注
let selectedInfo = null; // 当前选中的文本信息

// 回调
let onAnnotationCreated = null;
let onAnnotationClicked = null;

/**
 * 初始化标注模块
 */
export function initAnnotator(callbacks = {}) {
    onAnnotationCreated = callbacks.onAnnotationCreated;
    onAnnotationClicked = callbacks.onAnnotationClicked;

    // 颜色按钮事件
    const toolbar = $('#annotation-toolbar');
    toolbar.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const color = btn.dataset.color;
            createAnnotation(color);
        });
    });

    // 插入笔记按钮
    $('#btn-insert-to-note').addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectedInfo && onAnnotationCreated) {
            // 先创建标注（黄色默认），再通知插入笔记
            createAnnotation('#FBBF24', true);
        }
    });

    // 点击其他地方隐藏工具栏
    document.addEventListener('mousedown', (e) => {
        if (!toolbar.contains(e.target)) {
            hideToolbar();
        }
    });
}

/**
 * 设置当前 PDF 并加载标注
 */
export async function setPdfId(pdfId) {
    currentPdfId = pdfId;
    annotations = await storage.getAnnotationsByPdf(pdfId);
    return annotations;
}

/**
 * 在所有页面上渲染已有标注
 */
export function renderAllAnnotations() {
    // 先清除所有页面的高亮，确保删除后立即生效
    clearAllHighlights();

    // 按页面分组
    const byPage = {};
    for (const ann of annotations) {
        if (!byPage[ann.page]) byPage[ann.page] = [];
        byPage[ann.page].push(ann);
    }

    for (const [page, anns] of Object.entries(byPage)) {
        for (const ann of anns) {
            addHighlightToPage(parseInt(page), ann);
        }
    }
}

/**
 * 显示标注工具栏
 */
export function showToolbar(selectionInfo) {
    selectedInfo = selectionInfo;
    const toolbar = $('#annotation-toolbar');

    // 获取选区位置来定位工具栏
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 定位到选区上方
    toolbar.style.left = (rect.left + rect.width / 2 - 100) + 'px';
    toolbar.style.top = (rect.top - 50) + 'px';
    toolbar.style.display = 'flex';
}

/**
 * 隐藏工具栏
 */
export function hideToolbar() {
    const toolbar = $('#annotation-toolbar');
    toolbar.style.display = 'none';
    selectedInfo = null;
}

/**
 * 创建标注
 */
async function createAnnotation(color, insertToNote = false) {
    if (!selectedInfo || !currentPdfId) return;

    const annotation = await storage.addAnnotation({
        pdfId: currentPdfId,
        page: selectedInfo.page,
        text: selectedInfo.text,
        color: color,
        rects: selectedInfo.rects,
        noteId: null
    });

    annotations.push(annotation);

    // 在页面上渲染高亮
    addHighlightToPage(annotation.page, annotation);

    // 清除选择
    window.getSelection().removeAllRanges();
    hideToolbar();

    if (onAnnotationCreated) {
        onAnnotationCreated(annotation, insertToNote);
    }

    return annotation;
}

/**
 * 删除标注
 */
export async function removeAnnotation(id) {
    await storage.deleteAnnotation(id);
    annotations = annotations.filter(a => a.id !== id);
    // 重新渲染
    renderAllAnnotations();
}

/**
 * 关联标注到笔记
 */
export async function linkAnnotationToNote(annotationId, noteId) {
    const ann = annotations.find(a => a.id === annotationId);
    if (ann) {
        ann.noteId = noteId;
        await storage.updateAnnotation(ann);
    }
}

/**
 * 获取当前 PDF 的所有标注
 */
export function getAnnotations() {
    return annotations;
}

/**
 * 跳转到标注所在页面并闪烁
 */
export function navigateToAnnotation(annotation) {
    goToPage(annotation.page);
    setTimeout(() => {
        flashAnnotation(annotation.id);
    }, 400);
}

/**
 * 处理标注点击 — 跳转到关联笔记
 */
export function handleAnnotationClick(annotation) {
    if (onAnnotationClicked) {
        onAnnotationClicked(annotation);
    }
}
