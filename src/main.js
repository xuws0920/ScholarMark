/**
 * main.js - ScholarMark app entry
 */

import { initDB } from './modules/storage.js';
import { initPdfViewer, loadPdf, goToPage, setScale, getCurrentPage, getCurrentScale } from './modules/pdf-viewer.js';
import { initAnnotator, setPdfId as setAnnotatorPdf, showToolbar, renderAllAnnotations, getAnnotations, navigateToAnnotation, linkAnnotationToNote, removeAnnotation } from './modules/annotator.js';
import { initNoteEditor, setPdfId as setNoteEditorPdf, insertAnnotationRef, jumpToNoteByAnnotation, getNotes, getCurrentNote, removeAnnotationFromNotes } from './modules/note-editor.js';
import { initSummaryEditor, setPdfId as setSummaryPdf, getCurrentSummary, clearSummaryView } from './modules/summary-editor.js';
import { initLibrary, getPdfMeta } from './modules/library.js';
import { initSearch } from './modules/search.js';
import { initOutline, loadOutline, clearOutline } from './modules/outline.js';
import { chooseDirectory, exportNoteToDir, exportAllNotes, downloadNote } from './utils/export.js';
import { $, debounce } from './utils/dom.js';
import { renderMarkdown } from './utils/markdown.js';
import * as storage from './modules/storage.js';

let currentPdfId = null;
let dirHandle = null;
let dirPermissionState = 'unknown';
let contextMenuAnnotation = null;
let autoSaveBound = false;
let fileWriteChain = Promise.resolve();
let editingAnnotationId = null;

const READING_PROGRESS_PREFIX = 'readingProgress:';
const saveReadingProgressDebounced = debounce(async () => {
  await saveCurrentReadingProgress();
}, 400);
const autoSaveNoteDebounced = debounce(async () => {
  await autoSaveCurrentNoteToDirectory();
}, 800);
const autoSaveSummaryDebounced = debounce(async () => {
  await autoSaveCurrentSummaryToDirectory();
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

        await loadOutline();
        refreshAnnotationsList();
      },
      onPdfDeleted: () => {
        currentPdfId = null;
        $('#current-pdf-name').textContent = '未打开文献';
        $('#pdf-pages').innerHTML = '';
        $('#welcome-screen').style.display = 'flex';
        clearOutline();
        clearSummaryView();
      }
    });

    initOutline();

    initSearch({
      onAnnotationResultClick: async (annotation) => {
        if (annotation.pdfId !== currentPdfId) {
          const { selectPdf } = await import('./modules/library.js');
          await selectPdf(annotation.pdfId);
        }
        setTimeout(() => navigateToAnnotation(annotation), 500);
      },
      onNoteResultClick: async (note) => {
        if (note.pdfId !== currentPdfId) {
          const { selectPdf } = await import('./modules/library.js');
          await selectPdf(note.pdfId);
        }
        setTimeout(() => {
          applyWorkspace('notes');
          document.querySelector('#notes-tab-bar [data-tab="editor"]')?.click();
        }, 500);
      }
    });

    setupUIEvents();
    setupResizeHandles();
    initTheme();

    window._refreshAnnotations = renderAllAnnotations;
    window._refreshAnnotationsList = refreshAnnotationsList;
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
      alert(ok ? '导出成功' : '导出失败，请重新选择存储路径');
    } else {
      downloadNote(note.title, note.content);
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
      alert(`成功导出 ${count} 个笔记`);
    } else {
      for (const note of notes) downloadNote(note.title, note.content);
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
      alert(ok ? '总结导出成功' : '导出失败，请重新选择存储路径');
    } else {
      downloadNote(title, summary.content || '');
    }
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

function setupAutoSaveToDirectory() {
  if (autoSaveBound) return;
  autoSaveBound = true;

  $('#note-editor')?.addEventListener('input', () => {
    autoSaveNoteDebounced();
  });

  $('#summary-editor')?.addEventListener('input', () => {
    autoSaveSummaryDebounced();
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
    await exportNoteToDir(dirHandle, meta?.name || 'unknown', note.title, note.content || '');
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
    await exportNoteToDir(dirHandle, meta?.name || 'unknown', summary.title || '文献总结', summary.content || '');
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

  document.querySelectorAll('#workspace-switch .workspace-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.workspace === workspace);
  });

  $('#workspace-notes').style.display = isNotes ? 'flex' : 'none';
  $('#workspace-notes').classList.toggle('active', isNotes);
  $('#workspace-summary').style.display = isNotes ? 'none' : 'flex';
  $('#workspace-summary').classList.toggle('active', !isNotes);

  $('#notes-tab-bar').style.display = isNotes ? 'flex' : 'none';
  $('#summary-tab-bar').style.display = isNotes ? 'none' : 'flex';
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
    await storage.updateAnnotation(target);

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
    const collapsed = katexNode.offsetWidth === 0 || katexNode.offsetHeight === 0;
    if (hidden || collapsed) {
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
    const max = parseInt(getComputedStyle(sidebar).maxWidth, 10) || 600;

    if (newWidth >= min && newWidth <= max) {
      sidebar.style.width = newWidth + 'px';
    }
  }

  function onMouseUp() {
    handle.classList.remove('active');
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
}

init();
