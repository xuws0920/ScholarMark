/**
 * pdf-viewer.js — PDF 渲染与浏览模块
 * 
 * 基于 PDF.js 实现 PDF 加载、渲染、翻页、缩放
 */

import * as pdfjsLib from 'pdfjs-dist';
import { $ } from '../utils/dom.js';

// 配置 PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

// 状态
let pdfDoc = null;
let currentScale = 1.0;
let totalPages = 0;
let currentPage = 1;
let pageRendering = false;
let renderQueue = [];
let renderedPages = new Map(); // page number -> { canvas, textLayer, highlightLayer }

// 事件回调
let onPageChange = null;
let onTextSelected = null;
let onAnnotationClick = null;
let onScaleChange = null;

const SCALE_STEP = 0.15;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

/**
 * 初始化 PDF Viewer
 */
export function initPdfViewer(callbacks = {}) {
    onPageChange = callbacks.onPageChange;
    onTextSelected = callbacks.onTextSelected;
    onAnnotationClick = callbacks.onAnnotationClick;
    onScaleChange = callbacks.onScaleChange;

    // 工具栏事件
    $('#btn-prev-page').addEventListener('click', () => goToPage(currentPage - 1));
    $('#btn-next-page').addEventListener('click', () => goToPage(currentPage + 1));
    $('#btn-zoom-in').addEventListener('click', () => setScale(currentScale + SCALE_STEP));
    $('#btn-zoom-out').addEventListener('click', () => setScale(currentScale - SCALE_STEP));
    $('#btn-fit-width').addEventListener('click', fitWidth);

    $('#page-num-input').addEventListener('change', (e) => {
        const page = parseInt(e.target.value);
        if (page >= 1 && page <= totalPages) {
            goToPage(page);
        } else {
            e.target.value = currentPage;
        }
    });

    // 监听滚动以更新当前页码
    const container = $('#pdf-container');
    container.addEventListener('scroll', handleScroll);

    // 监听文本选择
    document.addEventListener('mouseup', handleTextSelection);
}

/**
 * 加载 PDF 文件
 */
export async function loadPdf(arrayBuffer) {
    // 清理旧的渲染
    clearRenderedPages();

    const container = $('#pdf-pages');
    container.innerHTML = '';

    // 隐藏欢迎页
    const welcome = $('#welcome-screen');
    if (welcome) welcome.style.display = 'none';

    // 显示加载状态
    container.innerHTML = '<div class="pdf-loading"><div class="spinner"></div><span>加载中...</span></div>';

    try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;

        // 更新 UI
        $('#page-count').textContent = totalPages;
        $('#page-num-input').max = totalPages;
        updateToolbarState();

        // 清空加载状态
        container.innerHTML = '';

        // 渲染所有页面（懒加载方式，先渲染可视区域）
        await renderAllPages();

        return pdfDoc;
    } catch (err) {
        container.innerHTML = `<div class="pdf-loading"><span>⚠️ PDF 加载失败: ${err.message}</span></div>`;
        throw err;
    }
}

/**
 * 渲染所有页面
 */
async function renderAllPages() {
    const container = $('#pdf-pages');

    for (let i = 1; i <= totalPages; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = i;
        wrapper.id = `page-${i}`;

        const canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';

        const textLayer = document.createElement('div');
        textLayer.className = 'text-layer';

        const highlightLayer = document.createElement('div');
        highlightLayer.className = 'highlight-layer';

        wrapper.appendChild(canvas);
        wrapper.appendChild(highlightLayer);
        wrapper.appendChild(textLayer);

        const pageLabel = document.createElement('div');
        pageLabel.className = 'page-number-label';
        pageLabel.textContent = `${i} / ${totalPages}`;

        container.appendChild(wrapper);
        container.appendChild(pageLabel);

        renderedPages.set(i, { wrapper, canvas, textLayer, highlightLayer });
    }

    // 渲染所有页面
    for (let i = 1; i <= totalPages; i++) {
        await renderPage(i);
    }
}

/**
 * 渲染单页
 */
async function renderPage(pageNum) {
    if (!pdfDoc) return;

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentScale });

    const { canvas, textLayer, highlightLayer, wrapper } = renderedPages.get(pageNum);
    const ctx = canvas.getContext('2d');

    // 设置 canvas 尺寸（考虑设备像素比）
    const dpr = window.devicePixelRatio || 1;
    canvas.width = viewport.width * dpr;
    canvas.height = viewport.height * dpr;
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    ctx.scale(dpr, dpr);

    // 设置容器尺寸
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    // 渲染 PDF 页面到 canvas
    await page.render({
        canvasContext: ctx,
        viewport: viewport
    }).promise;

    // 渲染文本层
    textLayer.innerHTML = '';
    textLayer.style.width = viewport.width + 'px';
    textLayer.style.height = viewport.height + 'px';
    highlightLayer.style.width = viewport.width + 'px';
    highlightLayer.style.height = viewport.height + 'px';

    const textContent = await page.getTextContent();
    const textItems = textContent.items;

    for (const item of textItems) {
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = tx[4] + 'px';
        span.style.top = (tx[5] - item.height) + 'px';
        span.style.fontSize = Math.abs(tx[3]) + 'px';
        span.style.fontFamily = item.fontName || 'sans-serif';

        // 计算文本宽度，如有必要进行拉伸
        if (item.width > 0) {
            span.style.width = item.width * viewport.scale + 'px';
            // 使用 scaleX transform 来适配宽度
        }

        textLayer.appendChild(span);
    }
}

/**
 * 跳转到指定页面
 */
export function goToPage(pageNum) {
    if (pageNum < 1 || pageNum > totalPages) return;

    currentPage = pageNum;
    updateToolbarState();

    const wrapper = $(`#page-${pageNum}`);
    if (wrapper) {
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (onPageChange) onPageChange(pageNum);
}

/**
 * 设置缩放
 */
export async function setScale(scale) {
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (Math.abs(scale - currentScale) < 0.01) return;

    currentScale = scale;
    $('#zoom-level').textContent = Math.round(scale * 100) + '%';

    // 重新渲染所有页面
    for (let i = 1; i <= totalPages; i++) {
        await renderPage(i);
    }

    // 刷新标注显示
    if (window._refreshAnnotations) {
        window._refreshAnnotations();
    }

    if (onScaleChange) onScaleChange(currentScale);
}

/**
 * 适应宽度
 */
function fitWidth() {
    if (!pdfDoc) return;

    const container = $('#pdf-container');
    const containerWidth = container.clientWidth - 60; // 减去 padding

    pdfDoc.getPage(1).then(page => {
        const viewport = page.getViewport({ scale: 1.0 });
        const newScale = containerWidth / viewport.width;
        setScale(newScale);
    });
}

/**
 * 滚动时更新当前页码
 */
function handleScroll() {
    const container = $('#pdf-container');
    const scrollTop = container.scrollTop;
    const containerHeight = container.clientHeight;

    for (let i = 1; i <= totalPages; i++) {
        const wrapper = $(`#page-${i}`);
        if (!wrapper) continue;

        const rect = wrapper.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
            if (currentPage !== i) {
                currentPage = i;
                updateToolbarState();
                if (onPageChange) onPageChange(i);
            }
            break;
        }
    }
}

/**
 * 文本选择处理
 */
function handleTextSelection(e) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        return;
    }

    // 检查选中是否在 PDF 文本层内
    const range = selection.getRangeAt(0);
    const textLayer = range.startContainer.parentElement?.closest('.text-layer');
    if (!textLayer) return;

    const pageWrapper = textLayer.closest('.pdf-page-wrapper');
    if (!pageWrapper) return;

    const pageNum = parseInt(pageWrapper.dataset.page);
    const selectedText = selection.toString().trim();

    // 获取选中区域的坐标（相对于页面）
    const rects = getSelectionRects(range, pageWrapper);

    if (onTextSelected) {
        onTextSelected({
            text: selectedText,
            page: pageNum,
            rects: rects,
            range: range
        });
    }
}

/**
 * 获取选中区域相对于页面的坐标（归一化到 scale=1.0）
 */
function getSelectionRects(range, pageWrapper) {
    const clientRects = range.getClientRects();
    const wrapperRect = pageWrapper.getBoundingClientRect();
    const rects = [];
    const scale = currentScale || 1.0;

    for (const rect of clientRects) {
        // 归一化到 scale=1.0，存储时不受当前缩放影响
        rects.push({
            x: (rect.left - wrapperRect.left) / scale,
            y: (rect.top - wrapperRect.top) / scale,
            w: rect.width / scale,
            h: rect.height / scale
        });
    }

    return rects;
}

/**
 * 在指定页面的高亮层添加标注
 */
export function addHighlightToPage(pageNum, annotation) {
    const pageData = renderedPages.get(pageNum);
    if (!pageData) return;

    const { highlightLayer } = pageData;
    const scale = currentScale || 1.0;

    for (const rect of annotation.rects) {
        const mark = document.createElement('div');
        mark.className = 'highlight-mark';
        mark.dataset.annotationId = annotation.id;
        // 坐标按当前缩放比例渲染（rect 存储的是 scale=1.0 的归一化坐标）
        mark.style.left = (rect.x * scale) + 'px';
        mark.style.top = (rect.y * scale) + 'px';
        mark.style.width = (rect.w * scale) + 'px';
        mark.style.height = (rect.h * scale) + 'px';
        mark.style.backgroundColor = annotation.color + '55'; // 半透明
        mark.style.color = annotation.color;

        // 点击标注 → 显示上下文菜单
        mark.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onAnnotationClick) {
                onAnnotationClick(annotation, e);
            }
        });

        highlightLayer.appendChild(mark);
    }
}

/**
 * 清除指定页面的所有高亮
 */
export function clearHighlightsOnPage(pageNum) {
    const pageData = renderedPages.get(pageNum);
    if (!pageData) return;
    pageData.highlightLayer.innerHTML = '';
}

/**
 * 清除所有页面的高亮
 */
export function clearAllHighlights() {
    for (const [pageNum, pageData] of renderedPages) {
        pageData.highlightLayer.innerHTML = '';
    }
}

/**
 * 让指定标注闪烁高亮
 */
export function flashAnnotation(annotationId) {
    const marks = document.querySelectorAll(`[data-annotation-id="${annotationId}"]`);
    marks.forEach(mark => {
        mark.classList.add('flash-highlight');
        setTimeout(() => mark.classList.remove('flash-highlight'), 1500);
    });
}

/**
 * 更新工具栏状态
 */
function updateToolbarState() {
    $('#page-num-input').value = currentPage;
    $('#btn-prev-page').disabled = currentPage <= 1;
    $('#btn-next-page').disabled = currentPage >= totalPages;
}

function clearRenderedPages() {
    renderedPages.clear();
    pdfDoc = null;
    totalPages = 0;
    currentPage = 1;
}

export function getCurrentPage() { return currentPage; }
export function getTotalPages() { return totalPages; }
export function getCurrentScale() { return currentScale; }
export function getPdfDoc() { return pdfDoc; }
