import * as pdfjsLib from 'pdfjs-dist';
import { $ } from '../utils/dom.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString();

let pdfDoc = null;
let currentScale = 1.0;
let totalPages = 0;
let currentPage = 1;
let renderedPages = new Map();
let figureCaptureState = null;

let onPageChange = null;
let onTextSelected = null;
let onAnnotationClick = null;
let onScaleChange = null;

const SCALE_STEP = 0.15;
const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;

export function initPdfViewer(callbacks = {}) {
    onPageChange = callbacks.onPageChange;
    onTextSelected = callbacks.onTextSelected;
    onAnnotationClick = callbacks.onAnnotationClick;
    onScaleChange = callbacks.onScaleChange;

    $('#btn-prev-page')?.addEventListener('click', () => goToPage(currentPage - 1));
    $('#btn-next-page')?.addEventListener('click', () => goToPage(currentPage + 1));
    $('#btn-zoom-in')?.addEventListener('click', () => setScale(currentScale + SCALE_STEP));
    $('#btn-zoom-out')?.addEventListener('click', () => setScale(currentScale - SCALE_STEP));
    $('#btn-fit-width')?.addEventListener('click', fitWidth);

    $('#page-num-input')?.addEventListener('change', (e) => {
        const page = parseInt(e.target.value, 10);
        if (Number.isFinite(page) && page >= 1 && page <= totalPages) {
            goToPage(page);
        } else {
            e.target.value = String(currentPage);
        }
    });

    $('#pdf-container')?.addEventListener('scroll', handleScroll);
    $('#pdf-pages')?.addEventListener('scroll', handleScroll);
    document.addEventListener('mouseup', handleTextSelection);
}

export async function loadPdf(arrayBuffer) {
    clearRenderedPages();

    const pages = $('#pdf-pages');
    if (!pages) return null;
    pages.innerHTML = '';

    const welcome = $('#welcome-screen');
    if (welcome) welcome.style.display = 'none';

    pages.innerHTML = '<div class="pdf-loading"><div class="spinner"></div><span>加载中...</span></div>';

    try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        pdfDoc = await loadingTask.promise;
        totalPages = pdfDoc.numPages;
        currentPage = 1;

        $('#page-count').textContent = String(totalPages);
        $('#page-num-input').max = String(totalPages);
        updateToolbarState();

        pages.innerHTML = '';
        await renderAllPages();
        return pdfDoc;
    } catch (err) {
        pages.innerHTML = `<div class="pdf-loading"><span>PDF 加载失败: ${err?.message || '未知错误'}</span></div>`;
        throw err;
    }
}

async function renderAllPages() {
    const pages = $('#pdf-pages');
    if (!pages) return;

    for (let i = 1; i <= totalPages; i += 1) {
        const wrapper = document.createElement('div');
        wrapper.className = 'pdf-page-wrapper';
        wrapper.dataset.page = String(i);
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

        pages.appendChild(wrapper);
        pages.appendChild(pageLabel);
        renderedPages.set(i, { wrapper, canvas, textLayer, highlightLayer });
    }

    for (let i = 1; i <= totalPages; i += 1) {
        await renderPage(i);
    }
}

async function renderPage(pageNum) {
    if (!pdfDoc) return;
    if (!Number.isFinite(currentScale) || currentScale <= 0) currentScale = 1.0;

    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: currentScale });

    const pageData = renderedPages.get(pageNum);
    if (!pageData) return;

    const { canvas, textLayer, highlightLayer, wrapper } = pageData;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;

    await page.render({ canvasContext: ctx, viewport }).promise;

    textLayer.innerHTML = '';
    textLayer.style.width = `${viewport.width}px`;
    textLayer.style.height = `${viewport.height}px`;
    highlightLayer.style.width = `${viewport.width}px`;
    highlightLayer.style.height = `${viewport.height}px`;

    const textContent = await page.getTextContent();
    for (const item of textContent.items) {
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.left = `${tx[4]}px`;
        span.style.top = `${tx[5] - item.height}px`;
        span.style.fontSize = `${Math.abs(tx[3])}px`;
        span.style.fontFamily = item.fontName || 'sans-serif';
        if (item.width > 0) {
            span.style.width = `${item.width * viewport.scale}px`;
        }
        textLayer.appendChild(span);
    }
}

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

export async function setScale(scale) {
    if (!Number.isFinite(scale)) return;
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
    if (!Number.isFinite(scale)) return;
    if (Math.abs(scale - currentScale) < 0.01) return;

    currentScale = scale;
    $('#zoom-level').textContent = `${Math.round(scale * 100)}%`;

    for (let i = 1; i <= totalPages; i += 1) {
        await renderPage(i);
    }

    if (window._refreshAnnotations) window._refreshAnnotations();
    if (onScaleChange) onScaleChange(currentScale);
}

export function fitWidth() {
    if (!pdfDoc) return;

    const scrollHost = getPdfScrollHost();
    const widthBase = scrollHost?.getBoundingClientRect().width || 0;
    if (!Number.isFinite(widthBase) || widthBase <= 80) return;

    const targetWidth = Math.max(120, widthBase - 60);
    pdfDoc.getPage(1).then((page) => {
        const viewport = page.getViewport({ scale: 1.0 });
        if (!Number.isFinite(viewport.width) || viewport.width <= 1) return;
        const nextScale = targetWidth / viewport.width;
        if (!Number.isFinite(nextScale) || nextScale <= 0) return;
        setScale(nextScale);
    });
}

function getPdfScrollHost() {
    const container = $('#pdf-container');
    const pages = $('#pdf-pages');
    if (container?.classList.contains('split-view')) return pages || container;
    return container;
}

function handleScroll() {
    const scrollHost = getPdfScrollHost();
    if (!scrollHost) return;

    const hostRect = scrollHost.getBoundingClientRect();
    for (let i = 1; i <= totalPages; i += 1) {
        const wrapper = $(`#page-${i}`);
        if (!wrapper) continue;
        const rect = wrapper.getBoundingClientRect();

        if (rect.top < hostRect.bottom && rect.bottom > hostRect.top) {
            if (currentPage !== i) {
                currentPage = i;
                updateToolbarState();
                if (onPageChange) onPageChange(i);
            }
            break;
        }
    }
}

function handleTextSelection() {
    if (figureCaptureState?.active) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

    const range = selection.getRangeAt(0);
    const textLayer = range.startContainer.parentElement?.closest('.text-layer');
    if (!textLayer) return;

    const pageWrapper = textLayer.closest('.pdf-page-wrapper');
    if (!pageWrapper) return;

    const pageNum = parseInt(pageWrapper.dataset.page || '1', 10);
    const selectedText = selection.toString().trim();
    const rects = getSelectionRects(range, pageWrapper);

    if (onTextSelected) {
        onTextSelected({
            text: selectedText,
            page: pageNum,
            rects,
            range
        });
    }
}

function getSelectionRects(range, pageWrapper) {
    const clientRects = range.getClientRects();
    const wrapperRect = pageWrapper.getBoundingClientRect();
    const scale = currentScale || 1.0;
    const rects = [];

    for (const rect of clientRects) {
        rects.push({
            x: (rect.left - wrapperRect.left) / scale,
            y: (rect.top - wrapperRect.top) / scale,
            w: rect.width / scale,
            h: rect.height / scale
        });
    }

    return rects;
}

export function addHighlightToPage(pageNum, annotation) {
    const pageData = renderedPages.get(pageNum);
    if (!pageData) return;

    const { highlightLayer } = pageData;
    const scale = currentScale || 1.0;

    for (const rect of annotation.rects) {
        const mark = document.createElement('div');
        mark.className = 'highlight-mark';
        mark.dataset.annotationId = annotation.id;
        mark.style.left = `${rect.x * scale}px`;
        mark.style.top = `${rect.y * scale}px`;
        mark.style.width = `${rect.w * scale}px`;
        mark.style.height = `${rect.h * scale}px`;
        mark.style.backgroundColor = `${annotation.color}55`;
        mark.style.color = annotation.color;

        mark.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onAnnotationClick) onAnnotationClick(annotation, e);
        });

        highlightLayer.appendChild(mark);
    }
}

export function clearHighlightsOnPage(pageNum) {
    const pageData = renderedPages.get(pageNum);
    if (!pageData) return;
    pageData.highlightLayer.innerHTML = '';
}

export function clearAllHighlights() {
    for (const [, pageData] of renderedPages) {
        pageData.highlightLayer.innerHTML = '';
    }
}

export function flashAnnotation(annotationId) {
    const marks = document.querySelectorAll(`[data-annotation-id="${annotationId}"]`);
    marks.forEach((mark) => {
        mark.classList.add('flash-highlight');
        setTimeout(() => mark.classList.remove('flash-highlight'), 1500);
    });
}

function updateToolbarState() {
    $('#page-num-input').value = String(currentPage);
    $('#btn-prev-page').disabled = currentPage <= 1;
    $('#btn-next-page').disabled = currentPage >= totalPages;
}

function clearRenderedPages() {
    cancelFigureClipCapture();
    renderedPages.clear();
    pdfDoc = null;
    totalPages = 0;
    currentPage = 1;
}

export function startFigureClipCapture(callbacks = {}) {
    if (!pdfDoc || !renderedPages.size || figureCaptureState?.active) return false;

    const container = getPdfScrollHost();
    if (!container) return false;

    figureCaptureState = {
        active: true,
        container,
        current: null,
        onCaptured: callbacks.onCaptured || null,
        onCancel: callbacks.onCancel || null
    };

    container.classList.add('figure-capture-active');
    container.addEventListener('mousedown', handleCaptureMouseDown);
    container.addEventListener('mousemove', handleCaptureMouseMove);
    container.addEventListener('mouseup', handleCaptureMouseUp);
    document.addEventListener('keydown', handleCaptureKeyDown);
    return true;
}

export function cancelFigureClipCapture() {
    const state = figureCaptureState;
    if (!state?.active) return;

    state.container?.classList.remove('figure-capture-active');
    state.container?.removeEventListener('mousedown', handleCaptureMouseDown);
    state.container?.removeEventListener('mousemove', handleCaptureMouseMove);
    state.container?.removeEventListener('mouseup', handleCaptureMouseUp);
    document.removeEventListener('keydown', handleCaptureKeyDown);

    if (state.current?.rectEl?.parentElement) {
        state.current.rectEl.parentElement.removeChild(state.current.rectEl);
    }

    state.onCancel?.();
    figureCaptureState = null;
}

function handleCaptureKeyDown(e) {
    if (!figureCaptureState?.active) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        cancelFigureClipCapture();
    }
}

function handleCaptureMouseDown(e) {
    const state = figureCaptureState;
    if (!state?.active || e.button !== 0) return;

    const wrapper = e.target.closest('.pdf-page-wrapper');
    if (!wrapper || !state.container.contains(wrapper)) return;

    e.preventDefault();
    window.getSelection()?.removeAllRanges();

    const page = parseInt(wrapper.dataset.page || '1', 10);
    const wrapperRect = wrapper.getBoundingClientRect();
    const startX = clamp(e.clientX - wrapperRect.left, 0, wrapperRect.width);
    const startY = clamp(e.clientY - wrapperRect.top, 0, wrapperRect.height);

    const rectEl = document.createElement('div');
    rectEl.className = 'figure-capture-rect';
    rectEl.style.left = `${startX}px`;
    rectEl.style.top = `${startY}px`;
    rectEl.style.width = '0px';
    rectEl.style.height = '0px';
    wrapper.appendChild(rectEl);

    state.current = {
        wrapper,
        page,
        startX,
        startY,
        x: startX,
        y: startY,
        width: 0,
        height: 0,
        rectEl
    };
}

function handleCaptureMouseMove(e) {
    const state = figureCaptureState;
    const current = state?.current;
    if (!state?.active || !current) return;

    e.preventDefault();
    const wrapperRect = current.wrapper.getBoundingClientRect();
    const nowX = clamp(e.clientX - wrapperRect.left, 0, wrapperRect.width);
    const nowY = clamp(e.clientY - wrapperRect.top, 0, wrapperRect.height);

    const x = Math.min(current.startX, nowX);
    const y = Math.min(current.startY, nowY);
    const width = Math.abs(nowX - current.startX);
    const height = Math.abs(nowY - current.startY);

    current.x = x;
    current.y = y;
    current.width = width;
    current.height = height;

    current.rectEl.style.left = `${x}px`;
    current.rectEl.style.top = `${y}px`;
    current.rectEl.style.width = `${width}px`;
    current.rectEl.style.height = `${height}px`;
}

function handleCaptureMouseUp(e) {
    const state = figureCaptureState;
    const current = state?.current;
    if (!state?.active || !current) return;

    e.preventDefault();
    const { wrapper, rectEl, page, x, y, width, height } = current;
    state.current = null;

    if (rectEl?.parentElement) rectEl.parentElement.removeChild(rectEl);

    if (width < 12 || height < 12) {
        cancelFigureClipCapture();
        return;
    }

    const pageData = renderedPages.get(page);
    if (!pageData?.canvas) {
        cancelFigureClipCapture();
        return;
    }

    const dataUrl = cropCanvasRegion(pageData.canvas, wrapper, { x, y, width, height });
    if (dataUrl && state.onCaptured) {
        const wrapperRect = wrapper.getBoundingClientRect();
        const w = wrapperRect.width || 1;
        const h = wrapperRect.height || 1;
        state.onCaptured({
            page,
            imageDataUrl: dataUrl,
            rect: {
                x: x / w,
                y: y / h,
                w: width / w,
                h: height / h
            }
        });
    }

    cancelFigureClipCapture();
}

function cropCanvasRegion(canvas, wrapper, rect) {
    const wrapperRect = wrapper.getBoundingClientRect();
    const displayWidth = wrapperRect.width || parseFloat(canvas.style.width) || canvas.clientWidth || 1;
    const displayHeight = wrapperRect.height || parseFloat(canvas.style.height) || canvas.clientHeight || 1;
    const pxRatioX = canvas.width / displayWidth;
    const pxRatioY = canvas.height / displayHeight;

    const sx = Math.max(0, Math.floor(rect.x * pxRatioX));
    const sy = Math.max(0, Math.floor(rect.y * pxRatioY));
    const sw = Math.max(1, Math.floor(rect.width * pxRatioX));
    const sh = Math.max(1, Math.floor(rect.height * pxRatioY));

    const clippedW = Math.min(sw, canvas.width - sx);
    const clippedH = Math.min(sh, canvas.height - sy);
    if (clippedW <= 0 || clippedH <= 0) return '';

    const out = document.createElement('canvas');
    out.width = clippedW;
    out.height = clippedH;
    const ctx = out.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(canvas, sx, sy, clippedW, clippedH, 0, 0, clippedW, clippedH);
    return out.toDataURL('image/jpeg', 0.88);
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

export function capturePageImage(pageNum = currentPage) {
    const pageData = renderedPages.get(pageNum);
    if (!pageData?.canvas) return '';
    try {
        return pageData.canvas.toDataURL('image/jpeg', 0.88);
    } catch (err) {
        console.warn('Capture page image failed:', err);
        return '';
    }
}

export function getCurrentPage() {
    return currentPage;
}

export function getTotalPages() {
    return totalPages;
}

export function getCurrentScale() {
    return currentScale;
}

export function getPdfDoc() {
    return pdfDoc;
}
