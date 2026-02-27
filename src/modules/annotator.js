import { $ } from '../utils/dom.js';
import * as storage from './storage.js';
import { addHighlightToPage, clearAllHighlights, goToPage, flashAnnotation } from './pdf-viewer.js';

let currentPdfId = null;
let annotations = [];
let selectedInfo = null;
let currentStyle = 'highlight';
let currentColor = '#FBBF24';

let onAnnotationCreated = null;
let onAnnotationClicked = null;

export function initAnnotator(callbacks = {}) {
  onAnnotationCreated = callbacks.onAnnotationCreated;
  onAnnotationClicked = callbacks.onAnnotationClicked;

  const toolbar = $('#annotation-toolbar');
  const colorDrawer = $('#annotation-color-drawer');
  const colorToggleBtn = $('#btn-toggle-annotation-colors');
  if (!toolbar) return;

  toolbar.querySelectorAll('.style-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentStyle = btn.dataset.style || 'highlight';
      toolbar.querySelectorAll('.style-btn').forEach((x) => x.classList.toggle('active', x === btn));
      createAnnotation(currentColor);
    });
  });

  colorToggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!colorDrawer) return;
    colorDrawer.classList.toggle('open');
    colorDrawer.setAttribute('aria-hidden', colorDrawer.classList.contains('open') ? 'false' : 'true');
  });

  toolbar.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentColor = btn.dataset.color || currentColor;
      createAnnotation(currentColor);
      if (colorDrawer) {
        colorDrawer.classList.remove('open');
        colorDrawer.setAttribute('aria-hidden', 'true');
      }
    });
  });

  $('#btn-insert-to-note')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectedInfo && onAnnotationCreated) {
      createAnnotation(currentColor, true);
    }
  });

  document.addEventListener('mousedown', (e) => {
    const target = e.target;
    if (!toolbar.contains(target)) {
      hideToolbar();
    }
    if (colorDrawer && !colorDrawer.contains(target) && target !== colorToggleBtn) {
      colorDrawer.classList.remove('open');
      colorDrawer.setAttribute('aria-hidden', 'true');
    }
  });
}

export async function setPdfId(pdfId) {
  currentPdfId = pdfId;
  annotations = await storage.getAnnotationsByPdf(pdfId);
  return annotations;
}

export function renderAllAnnotations() {
  clearAllHighlights();
  const byPage = {};
  for (const ann of annotations) {
    if (!byPage[ann.page]) byPage[ann.page] = [];
    byPage[ann.page].push(ann);
  }
  for (const [page, anns] of Object.entries(byPage)) {
    for (const ann of anns) {
      addHighlightToPage(parseInt(page, 10), ann);
    }
  }
}

export function showToolbar(selectionInfo) {
  selectedInfo = selectionInfo;
  const toolbar = $('#annotation-toolbar');
  if (!toolbar) return;
  currentStyle = 'highlight';
  currentColor = '#FBBF24';
  toolbar.querySelectorAll('.style-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.style === 'highlight');
  });
  const colorDrawer = $('#annotation-color-drawer');
  if (colorDrawer) {
    colorDrawer.classList.remove('open');
    colorDrawer.setAttribute('aria-hidden', 'true');
  }

  const selection = window.getSelection();
  if (!selection?.rangeCount) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  toolbar.style.left = `${rect.left + rect.width / 2 - 120}px`;
  toolbar.style.top = `${rect.top - 54}px`;
  toolbar.style.display = 'flex';
}

export function hideToolbar() {
  const toolbar = $('#annotation-toolbar');
  if (!toolbar) return;
  toolbar.style.display = 'none';
  selectedInfo = null;
}

async function createAnnotation(color, insertToNote = false) {
  if (!selectedInfo || !currentPdfId) return;

  const annotation = await storage.addAnnotation({
    pdfId: currentPdfId,
    page: selectedInfo.page,
    text: selectedInfo.text,
    anchorText: selectedInfo.text,
    displayTextMd: '',
    questionMd: '',
    color,
    style: currentStyle,
    comment: '',
    entryMode: insertToNote ? 'note_insert' : 'comment_only',
    rects: selectedInfo.rects,
    noteId: null
  });

  annotations.push(annotation);
  addHighlightToPage(annotation.page, annotation);

  window.getSelection()?.removeAllRanges();
  hideToolbar();

  if (onAnnotationCreated) {
    onAnnotationCreated(annotation, insertToNote);
  }

  return annotation;
}

export async function removeAnnotation(id) {
  await storage.deleteAnnotation(id);
  annotations = annotations.filter((a) => a.id !== id);
  renderAllAnnotations();
}

export async function linkAnnotationToNote(annotationId, noteId) {
  const ann = annotations.find((a) => a.id === annotationId);
  if (ann) {
    ann.noteId = noteId;
    await storage.updateAnnotation(ann);
  }
}

export function getAnnotations() {
  return annotations;
}

export function navigateToAnnotation(annotation) {
  goToPage(annotation.page);
  setTimeout(() => {
    flashAnnotation(annotation.id);
  }, 400);
}

export function handleAnnotationClick(annotation) {
  if (onAnnotationClicked) onAnnotationClicked(annotation);
}
