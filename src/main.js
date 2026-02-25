/**
 * main.js - ScholarMark app entry
 */

import { initDB } from './modules/storage.js';
import { initPdfViewer, loadPdf, goToPage, setScale, fitWidth, getCurrentPage, getCurrentScale } from './modules/pdf-viewer.js';
import { initAnnotator, setPdfId as setAnnotatorPdf, showToolbar, renderAllAnnotations, getAnnotations, navigateToAnnotation, linkAnnotationToNote, removeAnnotation } from './modules/annotator.js';
import { initNoteEditor, setPdfId as setNoteEditorPdf, insertAnnotationRef, jumpToNoteByAnnotation, getNotes, getCurrentNote, removeAnnotationFromNotes } from './modules/note-editor.js';
import { initSummaryEditor, setPdfId as setSummaryPdf, getCurrentSummary, clearSummaryView, appendToSummary } from './modules/summary-editor.js';
import { initOverviewEditor, setPdfId as setOverviewPdf, clearOverviewView, refreshOverview } from './modules/overview-editor.js';
import { initTranslationEditor, setPdfId as setTranslationPdf, clearTranslationView, getCurrentTranslationMarkdown, getFulltextTranslationMarkdown } from './modules/translation-editor.js';
import { initLibrary, getPdfMeta, getPdfList, selectPdf } from './modules/library.js';
import { initSearch } from './modules/search.js';
import { initOutline, loadOutline, clearOutline } from './modules/outline.js';
import { chooseDirectory, exportNoteToDir, exportAllNotes, downloadNote, getLastExportError } from './utils/export.js';
import { $, debounce } from './utils/dom.js';
import { renderMarkdown } from './utils/markdown.js';
import { attachMarkdownToolbar, initMarkdownToolbars } from './utils/markdown-toolbar.js';
import { markSaved, markSaveError } from './utils/save-status.js';
import * as storage from './modules/storage.js';

let currentPdfId = null;
let dirHandle = null;
let dirPermissionState = 'unknown';
let contextMenuAnnotation = null;
let autoSaveBound = false;
let fileWriteChain = Promise.resolve();
let editingAnnotationId = null;
let leftSidebarCollapsed = false;
let summaryCards = [];
let activeCardIndex = 0;
let cardLibraryOpen = false;
let cardSortMode = localStorage.getItem('cardSortMode') === 'name' ? 'name' : 'updated';
let collapsedLibraryDrawerOpen = false;
let collapsedLibraryQuery = '';

const READING_PROGRESS_PREFIX = 'readingProgress:';
const LEFT_SIDEBAR_COLLAPSED_KEY = 'leftSidebarCollapsed';
const LEFT_SIDEBAR_WIDTH_KEY = 'leftSidebarWidth';
const VIEWER_TRANSLATION_SPLIT_KEY = 'viewerTranslationSplit';
const SPLIT_PANE_WIDTH_KEY = 'splitPaneWidth';
let viewerTranslationSplit = localStorage.getItem(VIEWER_TRANSLATION_SPLIT_KEY) === '1';
const saveReadingProgressDebounced = debounce(async () => {
  await saveCurrentReadingProgress();
}, 400);
const autoSaveNoteDebounced = debounce(async () => {
  await autoSaveCurrentNoteToDirectory();
}, 800);
const autoSaveSummaryDebounced = debounce(async () => {
  await autoSaveCurrentSummaryToDirectory();
}, 800);
const autoSaveTranslationDebounced = debounce(async () => {
  await autoSaveCurrentTranslationToDirectory();
}, 800);

async function init() {
  try {
    await initDB();
    await restoreSavedDirectoryHandle();

    initPdfViewer({
      onPageChange: () => {
        saveReadingProgressDebounced();
      },
      onTextSelected: (selectionInfo) => {
        showToolbar(selectionInfo);
      },
      onAnnotationClick: (annotation, event) => {
        showAnnotationContextMenu(annotation, event);
      },
      onScaleChange: () => {
        saveReadingProgressDebounced();
      }
    });

    initAnnotator({
      onAnnotationCreated: async (annotation, insertToNote) => {
        if (insertToNote) {
          await insertAnnotationRef(annotation);
          const note = getCurrentNote();
          if (note) {
            await linkAnnotationToNote(annotation.id, note.id);
          }
        }
        refreshAnnotationsList();
        await refreshOverview();
      },
      onAnnotationClicked: (annotation) => {
        jumpToNoteByAnnotation(annotation);
      }
    });

    initNoteEditor({
      onAnnotationRefClick: (annotationId) => {
        const ann = getAnnotations().find(a => a.id === annotationId);
        if (ann) navigateToAnnotation(ann);
      }
    });

    initSummaryEditor();
    initOverviewEditor({
      onJumpToPage: (page) => goToPage(page)
    });
    initTranslationEditor({
      onInsertToSummary: async (markdown) => {
        const ok = await appendToSummary(markdown, '## AI 翻译');
        if (!ok) {
          alert('请先打开文献总结后再插入翻译内容');
        }
      }
    });

    await initLibrary({
      onPdfSelected: async (pdfData, meta) => {
        currentPdfId = pdfData.id;
        $('#current-pdf-name').textContent = meta.name;

        await loadPdf(pdfData.data);
        await restoreReadingProgress(pdfData.id);

        await setAnnotatorPdf(pdfData.id);
        renderAllAnnotations();

        await setNoteEditorPdf(pdfData.id);
        await setSummaryPdf(pdfData.id);
        await setOverviewPdf(pdfData.id);
        await setTranslationPdf(pdfData.id);

        await loadOutline();
        refreshAnnotationsList();
        renderCollapsedLibraryList();
      },
      onPdfDeleted: () => {
        currentPdfId = null;
        $('#current-pdf-name').textContent = '未打开文献';
        $('#pdf-pages').innerHTML = '';
        $('#welcome-screen').style.display = 'flex';
        clearOutline();
        clearSummaryView();
        clearOverviewView();
        clearTranslationView();
        refreshCardLibrary();
        renderCollapsedLibraryList();
      }
    });

    initOutline();

    initSearch({
      onAnnotationResultClick: async (annotation) => {
        if (annotation.pdfId !== currentPdfId) {
          await selectPdf(annotation.pdfId);
        }
        setTimeout(() => navigateToAnnotation(annotation), 500);
      },
      onNoteResultClick: async (note) => {
        if (note.pdfId !== currentPdfId) {
          await selectPdf(note.pdfId);
        }
        setTimeout(() => {
          applyWorkspace('notes');
          document.querySelector('#notes-tab-bar [data-tab="editor"]')?.click();
        }, 500);
      }
    });

    setupUIEvents();
    setupViewerTranslationSplit();
    setupResizeHandles();
    restoreSidebarLayoutState();
    setupCollapsedEntryRail();
    initTheme();
    bindCardLibraryKeys();
    initMarkdownToolbars([
      '#note-editor',
      '#summary-editor',
      '#figure-clip-note',
      '#translation-fulltext-editor'
    ]);

    window._refreshAnnotations = renderAllAnnotations;
    window._refreshAnnotationsList = refreshAnnotationsList;
    window._onSidebarTabChange = handleSidebarTabChange;
  } catch (err) {
    console.error('Init failed:', err);
  }
}

function readingProgressKey(pdfId) {
  return `${READING_PROGRESS_PREFIX}${pdfId}`;
}

async function saveCurrentReadingProgress() {
  if (!currentPdfId) return;

  await storage.setSetting(readingProgressKey(currentPdfId), {
    page: getSafeCurrentPage(),
    scale: getSafeCurrentScale(),
    updatedAt: new Date().toISOString()
  });
}

async function restoreReadingProgress(pdfId) {
  const progress = await storage.getSetting(readingProgressKey(pdfId));
  if (!progress || typeof progress !== 'object') return;

  if (typeof progress.scale === 'number' && Number.isFinite(progress.scale)) {
    await setScale(progress.scale);
  }
  if (typeof progress.page === 'number' && Number.isInteger(progress.page) && progress.page > 0) {
    goToPage(progress.page);
  }
}

function getSafeCurrentPage() {
  const page = getCurrentPage();
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function getSafeCurrentScale() {
  const scale = getCurrentScale();
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function initTheme() {
  const saved = localStorage.getItem('scholarmark-theme') || 'dark';
  applyTheme(saved);

  $('#btn-toggle-theme').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem('scholarmark-theme', next);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const iconDark = $('#icon-dark');
  const iconLight = $('#icon-light');
  if (theme === 'light') {
    iconDark.style.display = 'none';
    iconLight.style.display = 'block';
  } else {
    iconDark.style.display = 'block';
    iconLight.style.display = 'none';
  }
}

function setupUIEvents() {
  $('#btn-toggle-left-sidebar')?.addEventListener('click', () => {
    applyLeftSidebarCollapsed(!leftSidebarCollapsed);
  });

  $('#btn-settings').addEventListener('click', () => {
    $('#settings-modal').style.display = 'flex';
  });

  $('#btn-close-settings').addEventListener('click', () => {
    $('#settings-modal').style.display = 'none';
  });

  $('#settings-modal .modal-overlay').addEventListener('click', () => {
    $('#settings-modal').style.display = 'none';
  });

  $('#btn-choose-path').addEventListener('click', async () => {
    const handle = await chooseDirectory();
    if (!handle) return;
    await setDirectoryHandle(handle, true);
  });

  $('#btn-set-save-path')?.addEventListener('click', async () => {
    const handle = await chooseDirectory();
    if (!handle) return;
    await setDirectoryHandle(handle, true);
  });

  $('#btn-export-note')?.addEventListener('click', async () => {
    const note = getCurrentNote();
    if (!note) {
      alert('请先选择一个笔记');
      return;
    }

    if (await ensureWritableDirectory(true)) {
      const meta = getPdfMeta(currentPdfId);
      const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', note.title, note.content);
      alert(ok ? '导出成功（MD）' : `导出失败：${getLastExportError() || '请重新选择存储路径或检查内容'}`);
    } else {
      await downloadNote(note.title, note.content);
    }
  });

  $('#btn-export-all')?.addEventListener('click', async () => {
    const notes = getNotes();
    if (notes.length === 0) {
      alert('暂无笔记可导出');
      return;
    }

    if (await ensureWritableDirectory(true)) {
      const meta = getPdfMeta(currentPdfId);
      const count = await exportAllNotes(dirHandle, meta?.name || 'unknown', notes);
      alert(`成功导出 ${count} 个笔记（MD）`);
    } else {
      for (const note of notes) await downloadNote(note.title, note.content);
    }
  });

  $('#btn-export-summary')?.addEventListener('click', async () => {
    const summary = getCurrentSummary();
    if (!summary) {
      alert('请先打开一篇文献');
      return;
    }

    const title = summary.title || '文献总结';
    if (await ensureWritableDirectory(true)) {
      const meta = getPdfMeta(currentPdfId);
      const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', title, summary.content || '');
      alert(ok ? '总结导出成功（MD）' : `导出失败：${getLastExportError() || '请重新选择存储路径或检查内容'}`);
    } else {
      await downloadNote(title, summary.content || '');
    }
  });

  $('#btn-export-summary-card')?.addEventListener('click', async () => {
    if (!currentPdfId) {
      alert('请先打开一篇文献');
      return;
    }
    const summary = getCurrentSummary();
    if (!summary) {
      alert('请先打开总结内容');
      return;
    }
    const meta = getPdfMeta(currentPdfId);
    await storage.upsertSummaryCard({
      pdfId: currentPdfId,
      pdfName: meta?.name || '未知文献',
      content: summary.content || ''
    });
    await refreshCardLibrary(currentPdfId);
    alert('已导出为卡片（同文献会覆盖旧卡片）');
  });

  $('#btn-export-translation-current')?.addEventListener('click', async () => {
    const content = getCurrentTranslationMarkdown();
    if (!content.trim()) {
      alert('暂无可导出的翻译内容');
      return;
    }
    const page = getCurrentPage() || 1;
    const title = `翻译-P${page}`;
    if (await ensureWritableDirectory(true)) {
      const meta = getPdfMeta(currentPdfId);
      const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', title, content);
      alert(ok ? '翻译导出成功（MD）' : `导出失败：${getLastExportError() || '请重新选择存储路径或检查内容'}`);
    } else {
      await downloadNote(title, content);
    }
  });

  $('#btn-export-translation-all')?.addEventListener('click', async () => {
    const content = getFulltextTranslationMarkdown();
    if (!content.trim()) {
      alert('暂无全文翻译内容');
      return;
    }
    const title = '全文翻译';
    if (await ensureWritableDirectory(true)) {
      const meta = getPdfMeta(currentPdfId);
      const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', title, content);
      alert(ok ? '全文翻译导出成功（MD）' : `导出失败：${getLastExportError() || '请重新选择存储路径或检查内容'}`);
    } else {
      await downloadNote(title, content);
    }
  });

  $('#btn-close-card-library')?.addEventListener('click', () => {
    closeCardLibrary();
    activateSidebarTab('library');
  });

  $('#btn-card-prev')?.addEventListener('click', () => {
    moveCard(-1);
  });

  $('#btn-card-next')?.addEventListener('click', () => {
    moveCard(1);
  });

  $('#btn-card-sort')?.addEventListener('click', async () => {
    cardSortMode = cardSortMode === 'updated' ? 'name' : 'updated';
    localStorage.setItem('cardSortMode', cardSortMode);
    await refreshCardLibrary();
  });

  setupAutoSaveToDirectory();
  setupWorkspaceSwitch();

  $('#ctx-view-note').addEventListener('click', () => {
    if (contextMenuAnnotation) jumpToNoteByAnnotation(contextMenuAnnotation);
    hideContextMenu();
  });

  $('#ctx-delete-annotation').addEventListener('click', async () => {
    if (contextMenuAnnotation) {
      if (!confirmDeleteAnnotation(contextMenuAnnotation)) {
        hideContextMenu();
        return;
      }
      await deleteAnnotationWithCascade(contextMenuAnnotation.id);
    }
    hideContextMenu();
  });

  document.addEventListener('mousedown', (e) => {
    const menu = $('#annotation-context-menu');
    if (menu.style.display !== 'none' && !menu.contains(e.target)) {
      hideContextMenu();
    }
  });
}

function setupCollapsedEntryRail() {
  const libraryBtn = $('#btn-collapsed-entry-library');
  const cardsBtn = $('#btn-collapsed-entry-cards');
  const closeBtn = $('#btn-close-collapsed-library-drawer');
  const searchInput = $('#collapsed-library-search');
  const drawer = $('#collapsed-library-drawer');
  if (!libraryBtn || !cardsBtn || !closeBtn || !searchInput || !drawer) return;

  libraryBtn.addEventListener('click', () => {
    if (!leftSidebarCollapsed) return;
    toggleCollapsedLibraryDrawer();
  });

  cardsBtn.addEventListener('click', async () => {
    if (!leftSidebarCollapsed) return;
    closeCollapsedLibraryDrawer();
    activateSidebarTab('cards');
    await openCardLibrary();
    setCollapsedEntryActiveState('cards');
  });

  closeBtn.addEventListener('click', () => {
    closeCollapsedLibraryDrawer();
  });

  searchInput.addEventListener('input', (e) => {
    collapsedLibraryQuery = String(e.target.value || '').trim().toLowerCase();
    renderCollapsedLibraryList();
    updateCollapsedLibraryDrawerMaxHeight();
  });

  document.addEventListener('mousedown', (e) => {
    if (!collapsedLibraryDrawerOpen || !leftSidebarCollapsed) return;
    const target = e.target;
    if (drawer.contains(target) || libraryBtn.contains(target)) return;
    closeCollapsedLibraryDrawer();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && collapsedLibraryDrawerOpen) {
      closeCollapsedLibraryDrawer();
    }
  });

  window.addEventListener('resize', () => {
    if (collapsedLibraryDrawerOpen) {
      updateCollapsedLibraryDrawerMaxHeight();
    }
  });

  renderCollapsedLibraryList();
}

function setupViewerTranslationSplit() {
  const btn = $('#btn-toggle-translation-split');
  const container = $('#pdf-container');
  if (!btn || !container) return;

  btn.addEventListener('click', () => {
    viewerTranslationSplit = !viewerTranslationSplit;
    localStorage.setItem(VIEWER_TRANSLATION_SPLIT_KEY, viewerTranslationSplit ? '1' : '0');
    applyViewerTranslationSplitState();
    syncViewerTranslationPreview();
    // 等待布局更新完成后重新适配 PDF 宽度
    requestAnimationFrame(() => fitWidth());
  });

  window.addEventListener('translation:fulltext-preview-updated', (event) => {
    const html = event?.detail?.html || '';
    syncViewerTranslationPreview(html);
  });

  applyViewerTranslationSplitState();
  syncViewerTranslationPreview();
  setupSplitResize();
}

function setupSplitResize() {
  const handle = $('#resize-split');
  const pane = $('#pdf-translation-pane');
  const container = $('#pdf-container');
  if (!handle || !pane || !container) return;

  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    if (!viewerTranslationSplit) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = pane.getBoundingClientRect().width;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    // 向左拖 => diff 为负 => 翻译面板变宽
    const diff = e.clientX - startX;
    const newWidth = startWidth - diff;
    const containerWidth = container.getBoundingClientRect().width;
    const minWidth = 260;
    const maxWidth = containerWidth * 0.7;

    if (newWidth >= minWidth && newWidth <= maxWidth) {
      pane.style.width = newWidth + 'px';
    }
  }

  function onMouseUp() {
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    // 保存当前宽度
    const width = Math.round(pane.getBoundingClientRect().width);
    if (Number.isFinite(width) && width >= 260) {
      localStorage.setItem(SPLIT_PANE_WIDTH_KEY, String(width));
    }
    // 自适应 PDF 宽度
    requestAnimationFrame(() => fitWidth());
  }
}

function setupAutoSaveToDirectory() {
  if (autoSaveBound) return;
  autoSaveBound = true;

  $('#note-editor')?.addEventListener('input', () => {
    autoSaveNoteDebounced();
  });

  $('#summary-editor')?.addEventListener('input', () => {
    autoSaveSummaryDebounced();
  });

  $('#translation-fulltext-editor')?.addEventListener('input', () => {
    autoSaveTranslationDebounced();
  });
}

async function restoreSavedDirectoryHandle() {
  const savedName = await storage.getSetting('dirHandleName');
  const savedHandle = await storage.getSetting('dirHandle');

  if (savedHandle) {
    dirHandle = savedHandle;
    dirPermissionState = await queryDirectoryPermission(savedHandle, false);
    updateSavePathDisplay(savedHandle.name, dirPermissionState);
    return;
  }

  if (savedName) {
    dirPermissionState = 'missing';
    updateSavePathDisplay(savedName, dirPermissionState);
  } else {
    updateSavePathDisplay('', 'none');
  }
}

async function setDirectoryHandle(handle, requestPermission = false) {
  dirHandle = handle;
  await storage.setSetting('dirHandle', handle);
  await storage.setSetting('dirHandleName', handle.name);
  dirPermissionState = await queryDirectoryPermission(handle, requestPermission);
  updateSavePathDisplay(handle.name, dirPermissionState);
  markSaved('存储路径', '已保存');
}

async function queryDirectoryPermission(handle, requestPermission = false) {
  if (!handle?.queryPermission) return 'unsupported';

  try {
    let permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted' && requestPermission && handle.requestPermission) {
      permission = await handle.requestPermission({ mode: 'readwrite' });
    }
    return permission;
  } catch (err) {
    console.warn('Directory permission check failed:', err);
    return 'denied';
  }
}

function updateSavePathDisplay(name, permissionState) {
  const el = $('#save-path-display');
  if (!el) return;

  if (!name) {
    el.textContent = '未设置（使用浏览器下载）';
    return;
  }

  if (permissionState === 'granted') {
    el.textContent = `${name}（已授权，自动保存）`;
  } else if (permissionState === 'prompt') {
    el.textContent = `${name}（待授权）`;
  } else if (permissionState === 'missing') {
    el.textContent = `${name}（句柄失效，请重新选择）`;
  } else if (permissionState === 'unsupported') {
    el.textContent = `${name}（浏览器不支持权限查询）`;
  } else {
    el.textContent = `${name}（未授权）`;
  }
}

async function ensureWritableDirectory(requestPermission = false) {
  if (!dirHandle) return false;
  dirPermissionState = await queryDirectoryPermission(dirHandle, requestPermission);
  updateSavePathDisplay(dirHandle.name, dirPermissionState);
  return dirPermissionState === 'granted';
}

async function autoSaveCurrentNoteToDirectory() {
  if (!currentPdfId) return;
  const note = getCurrentNote();
  if (!note) return;

  const writable = await ensureWritableDirectory(false);
  if (!writable) return;

  const meta = getPdfMeta(currentPdfId);
  await enqueueFileWrite(async () => {
    const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', note.title, note.content || '');
    if (!ok) throw new Error(getLastExportError() || '笔记自动保存失败');
  });
}

async function autoSaveCurrentSummaryToDirectory() {
  if (!currentPdfId) return;
  const summary = getCurrentSummary();
  if (!summary) return;

  const writable = await ensureWritableDirectory(false);
  if (!writable) return;

  const meta = getPdfMeta(currentPdfId);
  await enqueueFileWrite(async () => {
    const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', summary.title || '文献总结', summary.content || '');
    if (!ok) throw new Error(getLastExportError() || '总结自动保存失败');
  });
}

async function autoSaveCurrentTranslationToDirectory() {
  if (!currentPdfId) return;
  const content = getFulltextTranslationMarkdown();
  if (!content.trim()) return;

  const writable = await ensureWritableDirectory(false);
  if (!writable) return;

  const meta = getPdfMeta(currentPdfId);
  await enqueueFileWrite(async () => {
    const ok = await exportNoteToDir(dirHandle, meta?.name || 'unknown', '全文翻译', content);
    if (!ok) throw new Error(getLastExportError() || '全文翻译自动保存失败');
  });
}

async function enqueueFileWrite(task) {
  fileWriteChain = fileWriteChain
    .then(async () => {
      await task();
    })
    .catch((err) => {
      console.warn('Auto save write failed:', err);
    });
  return fileWriteChain;
}

function setupWorkspaceSwitch() {
  document.querySelectorAll('#workspace-switch .workspace-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyWorkspace(btn.dataset.workspace);
    });
  });
}

function applyWorkspace(workspace) {
  const isNotes = workspace === 'notes';
  const isSummary = workspace === 'summary';
  const isOverview = workspace === 'overview';
  const isTranslation = workspace === 'translation';

  document.querySelectorAll('#workspace-switch .workspace-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.workspace === workspace);
  });

  $('#workspace-notes').style.display = isNotes ? 'flex' : 'none';
  $('#workspace-notes').classList.toggle('active', isNotes);
  $('#workspace-summary').style.display = isSummary ? 'flex' : 'none';
  $('#workspace-summary').classList.toggle('active', isSummary);
  $('#workspace-overview').style.display = isOverview ? 'flex' : 'none';
  $('#workspace-overview').classList.toggle('active', isOverview);
  $('#workspace-translation').style.display = isTranslation ? 'flex' : 'none';
  $('#workspace-translation').classList.toggle('active', isTranslation);

  $('#notes-tab-bar').style.display = isNotes ? 'flex' : 'none';
  $('#summary-tab-bar').style.display = isSummary ? 'flex' : 'none';
  $('#overview-tab-bar').style.display = isOverview ? 'flex' : 'none';
  $('#translation-tab-bar').style.display = isTranslation ? 'flex' : 'none';
}

function applyViewerTranslationSplitState() {
  const btn = $('#btn-toggle-translation-split');
  const container = $('#pdf-container');
  const pane = $('#pdf-translation-pane');
  if (!btn || !container) return;

  container.classList.toggle('split-view', viewerTranslationSplit);
  btn.classList.toggle('active', viewerTranslationSplit);
  btn.title = viewerTranslationSplit ? '关闭并排预览' : '并排预览全文翻译';
  if (pane) {
    pane.style.display = viewerTranslationSplit ? 'flex' : 'none';
    // 恢复保存的翻译面板宽度
    if (viewerTranslationSplit) {
      const savedWidth = localStorage.getItem(SPLIT_PANE_WIDTH_KEY);
      if (savedWidth) {
        pane.style.width = savedWidth + 'px';
      }
    } else {
      pane.style.width = '';
    }
  }
}

function syncViewerTranslationPreview(nextHtml = null) {
  const target = $('#pdf-translation-preview');
  if (!target) return;

  const html = typeof nextHtml === 'string'
    ? nextHtml
    : ($('#translation-fulltext-preview')?.innerHTML || '');

  if (!html || !html.trim()) {
    target.innerHTML = '<p class="empty-hint">暂无全文翻译内容</p>';
    return;
  }
  target.innerHTML = html;
}

function handleSidebarTabChange(target) {
  if (target === 'cards') {
    openCardLibrary();
    return;
  }
  closeCardLibrary();
}

async function openCardLibrary() {
  await refreshCardLibrary(currentPdfId);
  $('#card-library-view').style.display = 'block';
  cardLibraryOpen = true;
}

function closeCardLibrary() {
  $('#card-library-view').style.display = 'none';
  cardLibraryOpen = false;
  if (leftSidebarCollapsed) {
    setCollapsedEntryActiveState(null);
  }
}

function activateSidebarTab(target) {
  const tabs = document.querySelectorAll('.sidebar-tab');
  tabs.forEach((tab) => {
    const active = tab.dataset.sidebarTab === target;
    tab.classList.toggle('active', active);
  });
  const library = $('#pdf-library-wrapper');
  if (library) {
    library.style.display = target === 'library' ? 'flex' : 'none';
  }
}

async function refreshCardLibrary(preferPdfId = null) {
  const currentCardId = summaryCards[activeCardIndex]?.id || null;
  summaryCards = await storage.getAllSummaryCards();
  sortSummaryCards();

  if (summaryCards.length === 0) {
    activeCardIndex = 0;
    renderCardLibrary();
    return;
  }

  if (preferPdfId) {
    const idx = summaryCards.findIndex((c) => c.pdfId === preferPdfId);
    if (idx >= 0) {
      activeCardIndex = idx;
    } else if (currentCardId) {
      const byCard = summaryCards.findIndex((c) => c.id === currentCardId);
      activeCardIndex = byCard >= 0 ? byCard : Math.min(activeCardIndex, summaryCards.length - 1);
    } else {
      activeCardIndex = Math.min(activeCardIndex, summaryCards.length - 1);
    }
  } else {
    if (currentCardId) {
      const byCard = summaryCards.findIndex((c) => c.id === currentCardId);
      activeCardIndex = byCard >= 0 ? byCard : Math.min(activeCardIndex, summaryCards.length - 1);
    } else {
      activeCardIndex = Math.min(activeCardIndex, summaryCards.length - 1);
    }
  }

  renderCardLibrary();
}

function renderCardLibrary() {
  const total = summaryCards.length;
  const counter = $('#card-library-counter');
  const empty = $('#summary-card-empty');
  const content = $('#summary-card-content');
  const prevBtn = $('#btn-card-prev');
  const nextBtn = $('#btn-card-next');
  const md = $('#summary-card-markdown');
  const nameEl = $('#summary-card-pdf-name');
  const updatedAtEl = $('#summary-card-updated-at');
  renderCardSortButton();

  if (counter) counter.textContent = total === 0 ? '0 / 0' : `${activeCardIndex + 1} / ${total}`;

  if (total === 0) {
    empty.style.display = 'block';
    content.style.display = 'none';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const card = summaryCards[activeCardIndex];
  empty.style.display = 'none';
  content.style.display = 'flex';
  nameEl.textContent = card.pdfName || '未知文献';
  updatedAtEl.textContent = `更新于 ${formatDateTime(card.updatedAt)}`;
  md.innerHTML = renderMarkdown(card.content || '') || '<p class="empty-hint">暂无总结内容</p>';
  recoverInvisibleMathForCard(md);

  prevBtn.disabled = activeCardIndex <= 0;
  nextBtn.disabled = activeCardIndex >= total - 1;
}

function moveCard(step) {
  if (!summaryCards.length) return;
  const next = activeCardIndex + step;
  if (next < 0 || next >= summaryCards.length) return;
  activeCardIndex = next;
  renderCardLibrary();
}

function sortSummaryCards() {
  if (cardSortMode === 'name') {
    summaryCards.sort((a, b) => (a.pdfName || '').localeCompare((b.pdfName || ''), 'zh-CN'));
    return;
  }
  summaryCards.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function renderCardSortButton() {
  const btn = $('#btn-card-sort');
  if (!btn) return;
  btn.textContent = cardSortMode === 'updated' ? '按更新时间' : '按文献名';
  btn.title = cardSortMode === 'updated' ? '当前按更新时间排序，点击切换为按文献名' : '当前按文献名排序，点击切换为按更新时间';
}

function bindCardLibraryKeys() {
  document.addEventListener('keydown', (e) => {
    if (!cardLibraryOpen) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveCard(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveCard(1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeCardLibrary();
      activateSidebarTab('library');
    }
  });
}

function recoverInvisibleMathForCard(root) {
  const tokens = root.querySelectorAll('.math-token');
  tokens.forEach((token) => {
    const katexNode = token.querySelector('.katex');
    if (!katexNode) return;
    const style = window.getComputedStyle(katexNode);
    const hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    if (hidden) {
      token.textContent = token.dataset.raw || '';
      token.classList.add('math-token-fallback');
    }
  });
}

function formatDateTime(isoString) {
  if (!isoString) return '暂无';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '暂无';
  return d.toLocaleString();
}

function restoreSidebarLayoutState() {
  const savedWidth = parseInt(localStorage.getItem(LEFT_SIDEBAR_WIDTH_KEY) || '', 10);
  const leftSidebar = $('#sidebar-left');
  if (leftSidebar && Number.isFinite(savedWidth) && savedWidth >= 220 && savedWidth <= 450) {
    leftSidebar.style.width = `${savedWidth}px`;
  }

  const collapsed = localStorage.getItem(LEFT_SIDEBAR_COLLAPSED_KEY) === '1';
  applyLeftSidebarCollapsed(collapsed);
}

function applyLeftSidebarCollapsed(collapsed) {
  const appMain = $('#app-main');
  const leftSidebar = $('#sidebar-left');
  const toggleBtn = $('#btn-toggle-left-sidebar');
  if (!appMain || !leftSidebar || !toggleBtn) return;

  leftSidebarCollapsed = !!collapsed;

  if (leftSidebarCollapsed) {
    const currentWidth = leftSidebar.getBoundingClientRect().width;
    if (Number.isFinite(currentWidth) && currentWidth >= 220) {
      localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(Math.round(currentWidth)));
    }
  }

  appMain.classList.toggle('left-sidebar-collapsed', leftSidebarCollapsed);
  toggleBtn.textContent = leftSidebarCollapsed ? '⟩' : '⟨';
  toggleBtn.title = leftSidebarCollapsed ? '展开左侧栏' : '收起左侧栏';
  if (!leftSidebarCollapsed) {
    closeCollapsedLibraryDrawer();
    setCollapsedEntryActiveState(null);
  }
  localStorage.setItem(LEFT_SIDEBAR_COLLAPSED_KEY, leftSidebarCollapsed ? '1' : '0');
}

function toggleCollapsedLibraryDrawer() {
  if (collapsedLibraryDrawerOpen) {
    closeCollapsedLibraryDrawer();
    return;
  }
  openCollapsedLibraryDrawer();
}

function openCollapsedLibraryDrawer() {
  if (!leftSidebarCollapsed) return;
  const drawer = $('#collapsed-library-drawer');
  if (!drawer) return;

  renderCollapsedLibraryList();
  updateCollapsedLibraryDrawerMaxHeight();
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  collapsedLibraryDrawerOpen = true;
  setCollapsedEntryActiveState('library');
}

function closeCollapsedLibraryDrawer() {
  const drawer = $('#collapsed-library-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  collapsedLibraryDrawerOpen = false;
  setCollapsedEntryActiveState(null);
}

function setCollapsedEntryActiveState(activeTarget) {
  const libraryBtn = $('#btn-collapsed-entry-library');
  const cardsBtn = $('#btn-collapsed-entry-cards');
  if (libraryBtn) {
    const active = activeTarget === 'library';
    libraryBtn.classList.toggle('active', active);
    libraryBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (cardsBtn) {
    const active = activeTarget === 'cards' && cardLibraryOpen;
    cardsBtn.classList.toggle('active', active);
    cardsBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function renderCollapsedLibraryList() {
  const container = $('#collapsed-library-list');
  if (!container) return;

  const sorted = [...getPdfList()].sort((a, b) => {
    return new Date(b.lastOpenedAt || b.addedAt) - new Date(a.lastOpenedAt || a.addedAt);
  });
  const query = collapsedLibraryQuery;
  const filtered = query
    ? sorted.filter((pdf) => (pdf.name || '').toLowerCase().includes(query))
    : sorted;

  if (filtered.length === 0) {
    container.innerHTML = `<p class="outline-empty">${query ? '未匹配到文献' : '暂无文献'}</p>`;
    return;
  }

  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  filtered.forEach((pdf) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'collapsed-library-item';
    item.classList.toggle('active', pdf.id === currentPdfId);
    item.title = pdf.name || '未命名文献';
    item.innerHTML = `
      <span class="collapsed-library-item-name">${escapeHtml(pdf.name || '未命名文献')}</span>
      <span class="collapsed-library-item-meta">${formatDateTime(pdf.lastOpenedAt || pdf.addedAt)}</span>
    `;
    item.addEventListener('click', async () => {
      await selectPdf(pdf.id);
      closeCollapsedLibraryDrawer();
    });
    frag.appendChild(item);
  });
  container.appendChild(frag);
}

function updateCollapsedLibraryDrawerMaxHeight() {
  const drawer = $('#collapsed-library-drawer');
  const appMain = $('#app-main');
  if (!drawer || !appMain) return;

  const appRect = appMain.getBoundingClientRect();
  const drawerRect = drawer.getBoundingClientRect();
  const topOffset = Math.max(0, drawerRect.top - appRect.top);
  const maxHeight = Math.max(220, Math.floor(appRect.height - topOffset - 12));
  drawer.style.setProperty('--collapsed-library-drawer-max-height', `${maxHeight}px`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showAnnotationContextMenu(annotation, event) {
  contextMenuAnnotation = annotation;
  const menu = $('#annotation-context-menu');

  const viewNoteBtn = $('#ctx-view-note');
  viewNoteBtn.style.display = annotation.noteId ? 'flex' : 'none';

  const x = event?.clientX || event?.pageX || 200;
  const y = event?.clientY || event?.pageY || 200;

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'flex';

  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }
  });
}

function hideContextMenu() {
  $('#annotation-context-menu').style.display = 'none';
  contextMenuAnnotation = null;
}

function refreshAnnotationsList() {
  const container = $('#annotations-list');
  const annotations = getAnnotations();

  if (annotations.length === 0) {
    editingAnnotationId = null;
    container.innerHTML = '<p class="empty-hint">暂无标注</p>';
    return;
  }

  container.innerHTML = '';

  const colorNames = {
    '#FBBF24': '黄色标注',
    '#34D399': '绿色标注',
    '#60A5FA': '蓝色标注',
    '#A78BFA': '紫色标注',
    '#F87171': '红色标注'
  };

  const groups = {};
  for (const ann of annotations) {
    const key = ann.color || '#FBBF24';
    if (!groups[key]) groups[key] = [];
    groups[key].push(ann);
  }

  for (const [color, anns] of Object.entries(groups)) {
    const group = document.createElement('div');
    group.className = 'annotation-group';

    const header = document.createElement('div');
    header.className = 'annotation-group-header';
    header.innerHTML = `<span class="annotation-group-dot" style="background:${color}"></span> ${colorNames[color] || '标注'} (${anns.length})`;
    group.appendChild(header);

    anns.sort((a, b) => a.page - b.page);

    for (const ann of anns) {
      const item = buildAnnotationItem(ann);
      group.appendChild(item);
    }

    container.appendChild(group);
  }
}

async function deleteAnnotationWithCascade(annotationId) {
  if (!annotationId) return;

  await removeAnnotationFromNotes(annotationId);
  await removeAnnotation(annotationId);
  refreshAnnotationsList();
  await refreshOverview();
}

function confirmDeleteAnnotation(annotation) {
  if (!annotation) return false;

  const fragment = truncateForDialog(((annotation.displayTextMd || '').trim() || (annotation.text || '').trim()), 120);
  const question = truncateForDialog((annotation.questionMd || '').trim(), 120);

  let message = '删除该标注后，将同时删除笔记中与该标注关联的整块内容（引用块 + 你在块内写的内容）。\n\n';
  message += `片段预览：${fragment || '（空）'}`;
  if (question) {
    message += `\n问题预览：${question}`;
  }
  message += '\n\n是否继续删除？';

  return confirm(message);
}

function truncateForDialog(text, maxLen = 100) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLen) return flat;
  return `${flat.slice(0, maxLen - 1)}…`;
}

function buildAnnotationItem(ann) {
  const item = document.createElement('div');
  item.className = 'annotation-item';
  item.dataset.annotationId = ann.id;

  const color = document.createElement('div');
  color.className = 'annotation-item-color';
  color.style.background = ann.color || '#FBBF24';

  const content = document.createElement('div');
  content.className = 'annotation-item-content';

  const fragmentCard = document.createElement('div');
  fragmentCard.className = 'annotation-field-card';
  const fragmentLabel = document.createElement('div');
  fragmentLabel.className = 'annotation-field-label';
  fragmentLabel.textContent = '标注片段';
  const fragmentValue = document.createElement('div');
  fragmentValue.className = 'annotation-item-md markdown-body';

  const questionCard = document.createElement('div');
  questionCard.className = 'annotation-field-card annotation-question-card';
  const questionLabel = document.createElement('div');
  questionLabel.className = 'annotation-field-label';
  questionLabel.textContent = '问题';
  const questionValue = document.createElement('div');
  questionValue.className = 'annotation-item-md markdown-body';

  const rawText = (ann.text || '').trim();
  const displayText = (ann.displayTextMd || '').trim() || rawText;
  const questionText = (ann.questionMd || '').trim();

  renderMarkdownInto(
    fragmentValue,
    displayText,
    rawText ? '暂无可展示片段，可点击“编辑”修正' : '标注为空'
  );
  renderMarkdownInto(
    questionValue,
    questionText,
    '点击“编辑”补充这条标注对应的问题'
  );

  fragmentCard.append(fragmentLabel, fragmentValue);
  questionCard.append(questionLabel, questionValue);

  const meta = document.createElement('div');
  meta.className = 'annotation-item-meta';

  const page = document.createElement('span');
  page.textContent = `第 ${ann.page} 页`;
  meta.appendChild(page);

  if (ann.noteId) {
    const noteLink = document.createElement('span');
    noteLink.className = 'annotation-item-link';
    noteLink.textContent = '查看笔记';
    noteLink.dataset.noJump = '1';
    noteLink.addEventListener('click', (e) => {
      e.stopPropagation();
      jumpToNoteByAnnotation(ann);
    });
    meta.appendChild(noteLink);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'annotation-item-action';
  editBtn.dataset.noJump = '1';
  editBtn.textContent = editingAnnotationId === ann.id ? '收起' : '编辑';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    editingAnnotationId = editingAnnotationId === ann.id ? null : ann.id;
    refreshAnnotationsList();
  });
  meta.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'annotation-item-action annotation-item-delete';
  deleteBtn.dataset.noJump = '1';
  deleteBtn.title = '删除标注';
  deleteBtn.textContent = '删除';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirmDeleteAnnotation(ann)) return;
    if (editingAnnotationId === ann.id) editingAnnotationId = null;
    await deleteAnnotationWithCascade(ann.id);
  });
  meta.appendChild(deleteBtn);

  content.append(fragmentCard, questionCard);

  if (editingAnnotationId === ann.id) {
    content.appendChild(buildAnnotationEditor(ann));
  }

  content.appendChild(meta);
  item.append(color, content);

  item.addEventListener('click', (e) => {
    if (e.target.closest('[data-no-jump],a,button,textarea,input,label')) return;
    navigateToAnnotation(ann);
  });

  return item;
}

function buildAnnotationEditor(ann) {
  const panel = document.createElement('div');
  panel.className = 'annotation-inline-editor';
  panel.dataset.noJump = '1';

  const displayLabel = document.createElement('label');
  displayLabel.className = 'annotation-editor-label';
  displayLabel.textContent = '片段修正（Markdown / 公式）';

  const displayInput = document.createElement('textarea');
  displayInput.className = 'annotation-editor-textarea';
  displayInput.rows = 4;
  displayInput.placeholder = '可修正文献片段，支持 Markdown 和 $...$/$$...$$';
  displayInput.value = ann.displayTextMd || '';

  const questionLabel = document.createElement('label');
  questionLabel.className = 'annotation-editor-label';
  questionLabel.textContent = '对应问题（Markdown / 公式）';

  const questionInput = document.createElement('textarea');
  questionInput.className = 'annotation-editor-textarea';
  questionInput.rows = 3;
  questionInput.placeholder = '请输入这条标注想解决的问题';
  questionInput.value = ann.questionMd || '';

  attachMarkdownToolbar(displayInput);
  attachMarkdownToolbar(questionInput);

  const actions = document.createElement('div');
  actions.className = 'annotation-editor-actions';

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'annotation-item-action';
  resetBtn.textContent = '恢复原摘录';
  resetBtn.addEventListener('click', () => {
    displayInput.value = '';
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'annotation-item-action';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', () => {
    editingAnnotationId = null;
    refreshAnnotationsList();
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'annotation-item-action annotation-item-save';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', async () => {
    const annList = getAnnotations();
    const target = annList.find((x) => x.id === ann.id);
    if (!target) return;

    target.displayTextMd = displayInput.value.trim();
    target.questionMd = questionInput.value.trim();
    target.anchorText = target.anchorText || target.text || '';
    try {
      await storage.updateAnnotation(target);
      markSaved('标注', '已保存');
    } catch (err) {
      console.warn(err);
      markSaveError('标注', '保存失败');
    }

    editingAnnotationId = null;
    refreshAnnotationsList();
  });

  actions.append(resetBtn, cancelBtn, saveBtn);
  panel.append(displayLabel, displayInput, questionLabel, questionInput, actions);
  return panel;
}

function renderMarkdownInto(container, markdownText, emptyHint) {
  const source = (markdownText || '').trim();
  if (!source) {
    container.innerHTML = `<p class="annotation-empty-hint">${emptyHint}</p>`;
    return;
  }

  container.innerHTML = renderMarkdown(source);
  recoverInvisibleMath(container);
}

function recoverInvisibleMath(root) {
  const tokens = root.querySelectorAll('.math-token');
  tokens.forEach((token) => {
    const katexNode = token.querySelector('.katex');
    if (!katexNode) return;

    const style = window.getComputedStyle(katexNode);
    const hidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    if (hidden) {
      token.textContent = token.dataset.raw || '';
      token.classList.add('math-token-fallback');
    }
  });
}

function setupResizeHandles() {
  setupResize('resize-left', 'sidebar-left', 'left');
  setupResize('resize-right', 'sidebar-right', 'right');
}

function setupResize(handleId, sidebarId, side) {
  const handle = document.getElementById(handleId);
  const sidebar = document.getElementById(sidebarId);
  if (!handle || !sidebar) return;

  let startX, startWidth;

  handle.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  function onMouseMove(e) {
    const diff = e.clientX - startX;
    const newWidth = side === 'left' ? startWidth + diff : startWidth - diff;
    const min = parseInt(getComputedStyle(sidebar).minWidth, 10) || 220;
    const maxFallback = side === 'right' ? 880 : 450;
    const max = parseInt(getComputedStyle(sidebar).maxWidth, 10) || maxFallback;

    if (newWidth >= min && newWidth <= max) {
      sidebar.style.width = newWidth + 'px';
    }
  }

  function onMouseUp() {
    handle.classList.remove('active');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    if (side === 'left' && !leftSidebarCollapsed) {
      const width = Math.round(sidebar.getBoundingClientRect().width);
      if (Number.isFinite(width) && width >= 220 && width <= 450) {
        localStorage.setItem(LEFT_SIDEBAR_WIDTH_KEY, String(width));
      }
    }
  }
}

init();
