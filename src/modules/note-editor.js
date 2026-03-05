/**
 * note-editor.js - Markdown note editor module
 */

import { $, debounce } from '../utils/dom.js';
import { renderMarkdown } from '../utils/markdown.js';
import { extractImageFilesFromClipboard, hydrateMediaImages, insertImageBlocksAtCursor } from '../utils/media.js';
import { markSaved, markSaveError } from '../utils/save-status.js';
import * as storage from './storage.js';

let currentPdfId = null;
let currentNote = null;
let notes = [];
let noteOutlineItems = [];
let activeOutlineId = null;

let onAnnotationRefClick = null;

const OUTLINE_DRAWER_OPEN_KEY = 'notes-outline-drawer-open';
let outlineHeightRaf = 0;

export function initNoteEditor(callbacks = {}) {
  onAnnotationRefClick = callbacks.onAnnotationRefClick;

  const tabBtns = document.querySelectorAll('#notes-tab-bar .tab-btn');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('#workspace-notes .tab-panel').forEach((p) => p.classList.remove('active'));
      $(`#tab-${btn.dataset.tab}`)?.classList.add('active');

      updateOutlineVisibilityByTab(btn.dataset.tab);

      if (btn.dataset.tab === 'preview') {
        updatePreview();
      }
      if (btn.dataset.tab === 'annotations' && window._refreshAnnotationsList) {
        window._refreshAnnotationsList();
      }
    });
  });

  const editor = $('#note-editor');
  if (!editor) return;

  editor.addEventListener('paste', async (e) => {
    const imageFiles = extractImageFilesFromClipboard(e.clipboardData);
    if (imageFiles.length && currentPdfId) {
      e.preventDefault();
      await insertImageBlocksAtCursor({
        textarea: editor,
        pdfId: currentPdfId,
        files: imageFiles
      });
      return;
    }

    const text = pickBestPasteText(e.clipboardData);
    if (typeof text !== 'string' || text.length === 0) return;
    e.preventDefault();
    insertTextAtCursor(editor, text);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });

  editor.addEventListener('md-toolbar-image-files', async (e) => {
    const files = Array.from(e?.detail?.files || []);
    if (!files.length || !currentPdfId) return;
    await insertImageBlocksAtCursor({
      textarea: editor,
      pdfId: currentPdfId,
      files
    });
  });

  editor.addEventListener('input', debounce(async () => {
    if (!currentNote) return;
    currentNote.content = editor.value;
    try {
      await storage.updateNote(currentNote);
      await storage.syncMediaLinksForDocument({
        pdfId: currentPdfId,
        docType: 'note',
        docId: currentNote.id,
        markdown: currentNote.content || ''
      });
      markSaved('笔记', '已保存');
    } catch (err) {
      console.warn(err);
      markSaveError('笔记', '保存失败');
    }
    refreshNotesOutline(editor.value);
  }, 500));

  $('#note-select')?.addEventListener('change', async (e) => {
    const noteId = e.target.value;
    if (noteId) {
      await switchToNote(noteId);
    }
  });

  $('#btn-new-note')?.addEventListener('click', createNewNote);
  $('#btn-delete-note')?.addEventListener('click', deleteCurrentNote);

  $('#note-preview')?.addEventListener('click', (e) => {
    const ref = e.target.closest('.annotation-ref');
    if (ref && ref.dataset.annotationId && onAnnotationRefClick) {
      onAnnotationRefClick(ref.dataset.annotationId);
    }
  });

  $('#notes-outline-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.notes-outline-item');
    if (!btn) return;

    const outlineId = btn.dataset.outlineId;
    const item = noteOutlineItems.find((x) => x.outlineId === outlineId);
    if (!item) return;

    jumpToOutlineItem(item);
  });

  $('#btn-open-notes-outline')?.addEventListener('click', () => {
    toggleNotesOutlineDrawer();
  });
  $('#btn-toggle-notes-outline')?.addEventListener('click', closeNotesOutlineDrawer);

  restoreNotesOutlineDrawerState();
  window.addEventListener('resize', scheduleNotesOutlineHeightUpdate);
  const activeTab = document.querySelector('#notes-tab-bar .tab-btn.active')?.dataset.tab || 'editor';
  updateOutlineVisibilityByTab(activeTab);
}

export async function setPdfId(pdfId) {
  currentPdfId = pdfId;
  notes = await storage.getNotesByPdf(pdfId);

  updateNoteSelect();

  if (notes.length > 0) {
    await switchToNote(notes[0].id);
  } else {
    await createNewNote();
  }
}

async function switchToNote(noteId) {
  const note = await storage.getNote(noteId);
  if (!note) return;

  currentNote = note;
  $('#note-editor').value = note.content || '';
  $('#note-select').value = noteId;

  refreshNotesOutline(note.content || '');
  updatePreview();
}

async function createNewNote() {
  if (!currentPdfId) return;

  const count = notes.length + 1;
  const note = await storage.addNote({
    pdfId: currentPdfId,
    title: `笔记 ${count}`,
    content: '',
    linkedAnnotationIds: []
  });

  notes.push(note);
  updateNoteSelect();
  await switchToNote(note.id);
}

async function deleteCurrentNote() {
  if (!currentNote) return;
  if (!confirm(`确定删除“${currentNote.title}”吗？`)) return;

  await storage.deleteMediaLinksForDocument({
    pdfId: currentPdfId,
    docType: 'note',
    docId: currentNote.id
  });
  await storage.deleteNote(currentNote.id);
  notes = notes.filter((n) => n.id !== currentNote.id);

  if (notes.length > 0) {
    updateNoteSelect();
    await switchToNote(notes[0].id);
  } else {
    currentNote = null;
    updateNoteSelect();
    $('#note-editor').value = '';
    refreshNotesOutline('');
    updatePreview();
  }
}

export async function insertAnnotationRef(annotation) {
  if (!currentNote) {
    await createNewNote();
  }

  const editor = $('#note-editor');
  const refText = buildAnnotationBlock(annotation);

  const pos = editor.selectionStart;
  const before = editor.value.substring(0, pos);
  const after = editor.value.substring(pos);
  editor.value = before + refText + after;

  currentNote.content = editor.value;
  if (!currentNote.linkedAnnotationIds.includes(annotation.id)) {
    currentNote.linkedAnnotationIds.push(annotation.id);
  }
  await storage.updateNote(currentNote);
  await storage.syncMediaLinksForDocument({
    pdfId: currentPdfId,
    docType: 'note',
    docId: currentNote.id,
    markdown: currentNote.content || ''
  });
  markSaved('笔记', '已保存');

  annotation.noteId = currentNote.id;
  await storage.updateAnnotation(annotation);
  markSaved('标注关联', '已保存');

  editor.focus();
  editor.selectionStart = editor.selectionEnd = pos + refText.length;

  refreshNotesOutline(editor.value);
  updatePreview();
}

export async function removeAnnotationFromNotes(annotationId) {
  if (!annotationId || !Array.isArray(notes) || notes.length === 0) return;

  for (const note of notes) {
    const linked = Array.isArray(note.linkedAnnotationIds) ? note.linkedAnnotationIds : [];
    const hasLink = linked.includes(annotationId);
    const source = note.content || '';
    const cleaned = removeAnnotationBlockContent(source, annotationId);
    const contentChanged = cleaned !== source;
    const linkChanged = hasLink;

    if (!contentChanged && !linkChanged) {
      continue;
    }

    note.content = cleaned;
    note.linkedAnnotationIds = linked.filter((id) => id !== annotationId);
    await storage.updateNote(note);
    await storage.syncMediaLinksForDocument({
      pdfId: note.pdfId,
      docType: 'note',
      docId: note.id,
      markdown: note.content || ''
    });
    markSaved('笔记', '已保存');

    if (currentNote && currentNote.id === note.id) {
      currentNote.content = note.content;
      currentNote.linkedAnnotationIds = [...note.linkedAnnotationIds];
      const editor = $('#note-editor');
      if (editor) {
        editor.value = note.content || '';
      }
      refreshNotesOutline(note.content || '');
      updatePreview();
    }
  }
}

function updatePreview() {
  const editor = $('#note-editor');
  const preview = $('#note-preview');
  const content = editor?.value || '';

  refreshNotesOutline(content);

  let html = renderMarkdown(content);

  html = html.replace(
    /data-annotation-id="([^"]+)"/g,
    (match, id) => `data-annotation-id="${id}" class="annotation-ref" style="cursor:pointer;"`
  );

  preview.innerHTML = html || '<p class="empty-hint">暂无内容</p>';
  bindOutlineAnchorsToPreview(preview);
  recoverInvisibleMath(preview);
  void hydrateMediaImages(preview, currentPdfId);
}

function updateNoteSelect() {
  const select = $('#note-select');
  if (!select) return;

  select.innerHTML = '';

  if (notes.length === 0) {
    select.innerHTML = '<option value="">暂无笔记</option>';
    return;
  }

  for (const note of notes) {
    const opt = document.createElement('option');
    opt.value = note.id;
    opt.textContent = note.title;
    select.appendChild(opt);
  }

  if (currentNote) {
    select.value = currentNote.id;
  }
}

function refreshNotesOutline(content) {
  const source = typeof content === 'string' ? content : ($('#note-editor')?.value || '');
  noteOutlineItems = parseNoteOutlineItems(source);

  const list = $('#notes-outline-list');
  if (!list) return;

  if (noteOutlineItems.length === 0) {
    list.innerHTML = '<p class="empty-hint">暂无目录项</p>';
    activeOutlineId = null;
    scheduleNotesOutlineHeightUpdate();
    return;
  }

  list.innerHTML = '';
  for (const item of noteOutlineItems) {
    const btn = document.createElement('button');
    btn.className = 'notes-outline-item';
    if (activeOutlineId === item.outlineId) {
      btn.classList.add('active');
    }
    btn.dataset.outlineId = item.outlineId;
    btn.title = item.fullText;
    btn.innerHTML = `<span class="notes-outline-item-page">P${item.page}</span>${escapeHtml(item.shortText)}`;
    list.appendChild(btn);
  }
  scheduleNotesOutlineHeightUpdate();
}

function parseNoteOutlineItems(content) {
  if (!content) return [];

  const items = [];
  const pattern = />\s*🔖\s*\*\*\[P\s*(\d+)\]\*\*\s*([^\r\n]+)\r?\n>\s*<span[^>]*data-annotation-id="([^"]+)"[^>]*>/g;
  let m;
  let seq = 0;

  while ((m = pattern.exec(content)) !== null) {
    const page = parseInt(m[1], 10) || 0;
    const text = (m[2] || '').trim();
    const annotationId = m[3];
    const blockStart = m.index;
    const line = 1 + countNewLines(content, blockStart);
    const outlineId = `ann-${annotationId}-${seq}`;
    seq += 1;

    items.push({
      outlineId,
      annotationId,
      page,
      fullText: text,
      shortText: truncate(text, 42),
      blockStart,
      line,
    });
  }

  return items;
}

function buildAnnotationBlock(annotation) {
  const annId = annotation.id;
  const page = annotation.page;
  const text = annotation.text || '';

  return [
    '',
    `<!-- ANN_BLOCK_START:${annId} -->`,
    `> 🔖 **[P${page}]** ${text}`,
    `> <span class="ref-page" data-annotation-id="${annId}">↳ 第 ${page} 页标注</span>`,
    '',
    '',
    `<!-- ANN_BLOCK_END:${annId} -->`,
    ''
  ].join('\n');
}

function removeAnnotationBlockContent(content, annotationId) {
  if (!content || !annotationId) return content || '';

  const escapedId = escapeRegExp(annotationId);

  // 新格式：删除带唯一边界的完整引用块（含块内编辑内容）
  const markerPattern = new RegExp(
    `(?:\\n|^)\\s*<!--\\s*ANN_BLOCK_START:${escapedId}\\s*-->[\\s\\S]*?<!--\\s*ANN_BLOCK_END:${escapedId}\\s*-->\\s*(?=\\n|$)`,
    'g'
  );
  let next = content.replace(markerPattern, '\n');

  // 旧格式/手工改动格式兜底：只要命中 data-annotation-id，就删除其所属整块。
  const anchorPattern = new RegExp(
    `data-annotation-id\\s*=\\s*(['"])${escapedId}\\1`,
    'i'
  );

  while (true) {
    const m = anchorPattern.exec(next);
    if (!m) break;

    const anchorIndex = m.index;
    const lineStart = findLineStart(next, anchorIndex);
    const blockStart = expandBlockStart(next, lineStart);
    const blockEnd = expandBlockEnd(next, anchorIndex + m[0].length);

    if (blockEnd <= blockStart) break;
    next = `${next.slice(0, blockStart)}\n${next.slice(blockEnd)}`;
  }

  return normalizeNoteSpacing(next);
}

function normalizeNoteSpacing(content) {
  return (content || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLineStart(text, index) {
  const i = Math.max(0, Math.min(index, text.length));
  const p = text.lastIndexOf('\n', i);
  return p === -1 ? 0 : p + 1;
}

function findLineEnd(text, index) {
  const i = Math.max(0, Math.min(index, text.length));
  const p = text.indexOf('\n', i);
  return p === -1 ? text.length : p;
}

function getLineRangeAt(text, index) {
  const start = findLineStart(text, index);
  const end = findLineEnd(text, index);
  return { start, end, text: text.slice(start, end) };
}

function previousLineRange(text, lineStart) {
  if (lineStart <= 0) return null;
  const prevEnd = Math.max(0, lineStart - 1);
  const prevStart = findLineStart(text, prevEnd);
  return { start: prevStart, end: prevEnd, text: text.slice(prevStart, prevEnd) };
}

function nextLineRange(text, lineEnd) {
  if (lineEnd >= text.length) return null;
  const nextStart = lineEnd + 1;
  if (nextStart > text.length) return null;
  const nextEnd = findLineEnd(text, nextStart);
  return { start: nextStart, end: nextEnd, text: text.slice(nextStart, nextEnd) };
}

function expandBlockStart(text, fromLineStart) {
  let start = fromLineStart;

  while (true) {
    const prev = previousLineRange(text, start);
    if (!prev) break;

    const trimmed = prev.text.trim();
    if (
      trimmed === '' ||
      trimmed.startsWith('>') ||
      /^<!--\s*ANN_BLOCK_START:/.test(trimmed)
    ) {
      start = prev.start;
      continue;
    }
    break;
  }

  return start;
}

function expandBlockEnd(text, fromIndex) {
  let cursor = fromIndex;
  let line = getLineRangeAt(text, cursor);
  let end = line.end;

  while (true) {
    const next = nextLineRange(text, end);
    if (!next) {
      end = text.length;
      break;
    }

    const trimmed = next.text.trim();
    if (
      trimmed === '' ||
      /^<!--\s*ANN_BLOCK_END:/.test(trimmed)
    ) {
      end = next.end;
      continue;
    }

    if (
      /^<!--\s*ANN_BLOCK_START:/.test(trimmed) ||
      /^>\s*🔖\s*\*\*\[P/.test(trimmed) ||
      /data-annotation-id\s*=/.test(trimmed)
    ) {
      break;
    }

    end = next.end;
  }

  return end;
}

function jumpToOutlineItem(item) {
  activeOutlineId = item.outlineId;
  highlightActiveOutlineItem();

  const activeTab = document.querySelector('#notes-tab-bar .tab-btn.active')?.dataset.tab || 'editor';
  if (activeTab === 'preview') {
    // 保证预览 DOM 与最新笔记内容同步，且锚点已重新绑定。
    updatePreview();
    jumpInPreview(item);
  } else {
    jumpInEditor(item);
  }
}

function jumpInEditor(item) {
  const editor = $('#note-editor');
  if (!editor) return;

  const start = item.blockStart;
  const end = Math.min(editor.value.length, start + Math.max(item.fullText.length, 10));
  editor.focus();
  editor.setSelectionRange(start, end);

  // 主策略：用镜像元素测量字符真实像素位置，避免自动换行导致的偏移。
  const measuredTop = measureCaretTopInTextarea(editor, start);

  // 兜底策略：行号 + 比例估算，防止极端情况下测量失败。
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
  const lineNumber = 1 + countNewLines(editor.value, start);
  const byLineTop = Math.max(0, (lineNumber - 1) * lineHeight - editor.clientHeight * 0.35);
  const ratio = start / Math.max(editor.value.length, 1);
  const byRatioTop = Math.max(0, (editor.scrollHeight - editor.clientHeight) * ratio - editor.clientHeight * 0.2);
  const fallbackTop = Math.max(byLineTop, byRatioTop);

  const targetTop = Number.isFinite(measuredTop) ? Math.max(0, measuredTop - editor.clientHeight * 0.5) : fallbackTop;

  // 某些浏览器在 setSelectionRange 后不会立即滚动，分多帧和短延时强制兜底。
  requestAnimationFrame(() => {
    editor.scrollTop = targetTop;
    requestAnimationFrame(() => {
      editor.scrollTop = targetTop;
      setTimeout(() => {
        editor.scrollTop = targetTop;
      }, 40);
    });
  });
}

function measureCaretTopInTextarea(textarea, index) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement('div');

  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.zIndex = '-1';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.boxSizing = 'border-box';

  const copyProps = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'fontVariant',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'textIndent',
    'textAlign',
    'wordSpacing',
    'tabSize',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
  ];
  for (const p of copyProps) {
    mirror.style[p] = style[p];
  }

  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderRight = parseFloat(style.borderRightWidth) || 0;
  mirror.style.width = `${textarea.clientWidth + borderLeft + borderRight}px`;

  const safeIndex = Math.max(0, Math.min(index, textarea.value.length));
  const before = textarea.value.slice(0, safeIndex);
  const after = textarea.value.slice(safeIndex) || '.';
  mirror.textContent = before;

  const marker = document.createElement('span');
  marker.textContent = after[0];
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  document.body.removeChild(mirror);

  return top;
}

function jumpInPreview(item) {
  const preview = $('#note-preview');
  if (!preview) return;

  const target = findPreviewTarget(preview, item);
  if (!target) return;

  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('outline-jump-highlight');
  setTimeout(() => target.classList.remove('outline-jump-highlight'), 1500);
}

function bindOutlineAnchorsToPreview(previewRoot) {
  const queue = new Map();
  for (const item of noteOutlineItems) {
    if (!queue.has(item.annotationId)) queue.set(item.annotationId, []);
    queue.get(item.annotationId).push(item);
  }

  const refs = previewRoot.querySelectorAll('.annotation-ref[data-annotation-id]');
  refs.forEach((ref) => {
    const annId = ref.dataset.annotationId;
    const items = queue.get(annId);
    const item = items && items.length ? items.shift() : null;
    if (item) {
      // 将锚点绑到整段引用块，避免仅 span 被定位导致“看起来没跳”。
      const anchor = ref.closest('blockquote') || ref;
      anchor.dataset.outlineId = item.outlineId;
      anchor.dataset.annotationId = item.annotationId;
      anchor.dataset.outlineText = item.fullText;
      anchor.title = item.fullText;
    }
  });
}

function findPreviewTarget(previewRoot, item) {
  // 1. 精确锚点（由 bindOutlineAnchorsToPreview 绑定）
  let target = previewRoot.querySelector(`[data-outline-id="${item.outlineId}"]`);
  if (target) return target;

  // 2. annotationId 兜底
  target = previewRoot.querySelector(`[data-annotation-id="${item.annotationId}"]`);
  if (target) return target.closest('blockquote') || target;

  // 3. 文本片段兜底（兼容旧内容）
  const blockquotes = previewRoot.querySelectorAll('blockquote');
  for (const bq of blockquotes) {
    const txt = (bq.textContent || '').replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const needle = item.fullText.slice(0, Math.min(item.fullText.length, 24));
    if (needle && txt.includes(needle)) {
      return bq;
    }
  }

  return null;
}

function highlightActiveOutlineItem() {
  const list = $('#notes-outline-list');
  if (!list) return;
  list.querySelectorAll('.notes-outline-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.outlineId === activeOutlineId);
  });
}

function updateOutlineVisibilityByTab(tab) {
  if (tab === 'annotations') {
    closeNotesOutlineDrawer();
  }
}

function toggleNotesOutlineDrawer() {
  const panel = $('#notes-outline-panel');
  const opener = $('#btn-open-notes-outline');
  if (!panel) return;
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  panel.setAttribute('aria-hidden', opening ? 'false' : 'true');
  if (opener) opener.classList.toggle('active', opening);
  localStorage.setItem(OUTLINE_DRAWER_OPEN_KEY, opening ? '1' : '0');
  if (opening) {
    scheduleNotesOutlineHeightUpdate();
  } else {
    panel.style.height = '';
  }
}

function closeNotesOutlineDrawer() {
  const panel = $('#notes-outline-panel');
  const opener = $('#btn-open-notes-outline');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  panel.style.height = '';
  panel.style.left = '';
  panel.style.top = '';
  if (opener) opener.classList.remove('active');
  localStorage.setItem(OUTLINE_DRAWER_OPEN_KEY, '0');
}

function restoreNotesOutlineDrawerState() {
  const shouldOpen = localStorage.getItem(OUTLINE_DRAWER_OPEN_KEY) === '1';
  if (shouldOpen) {
    toggleNotesOutlineDrawer();
  } else {
    closeNotesOutlineDrawer();
  }
}

function scheduleNotesOutlineHeightUpdate() {
  if (outlineHeightRaf) {
    cancelAnimationFrame(outlineHeightRaf);
  }
  outlineHeightRaf = requestAnimationFrame(() => {
    outlineHeightRaf = 0;
    updateNotesOutlineDrawerHeight();
  });
}

function updateNotesOutlineDrawerHeight() {
  const drawer = $('#notes-outline-panel');
  if (!drawer || !drawer.classList.contains('open')) return;
  const sidebar = $('#sidebar-right');
  const viewer = $('#pdf-viewer-section');
  const layout = $('#notes-content-layout');
  if (!sidebar || !viewer || !layout) return;

  const sidebarRect = sidebar.getBoundingClientRect();
  const viewerRect = viewer.getBoundingClientRect();
  const layoutRect = layout.getBoundingClientRect();
  const drawerRect = drawer.getBoundingClientRect();
  const drawerWidth = drawerRect.width || 280;
  const gap = 10;

  const left = Math.max(viewerRect.left + gap, sidebarRect.left - drawerWidth - gap);
  const top = Math.max(viewerRect.top + gap, layoutRect.top + 6);
  const maxHeight = Math.max(180, Math.min(window.innerHeight - top - 10, viewerRect.bottom - top - gap));

  drawer.style.left = `${Math.round(left)}px`;
  drawer.style.top = `${Math.round(top)}px`;
  drawer.style.height = `${Math.round(maxHeight)}px`;
}

function countNewLines(text, endIndex) {
  let count = 0;
  for (let i = 0; i < endIndex && i < text.length; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  return `${text.slice(0, maxLen - 1)}…`;
}

function insertTextAtCursor(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  const pos = start + text.length;
  textarea.selectionStart = pos;
  textarea.selectionEnd = pos;
}

function pickBestPasteText(clipboardData) {
  const plain = clipboardData?.getData('text/plain') ?? '';
  const html = clipboardData?.getData('text/html') ?? '';

  if (containsMathDelimiter(plain)) {
    return plain;
  }

  const extractedFromHtml = extractTextFromHtml(html);
  if (containsMathDelimiter(extractedFromHtml)) {
    return extractedFromHtml;
  }

  return plain || extractedFromHtml || '';
}

function containsMathDelimiter(text) {
  if (!text) return false;
  return text.includes('$$') || /\$[^$\n]+\$/.test(text);
}

function extractTextFromHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6').forEach((el) => {
    if (!el.textContent?.endsWith('\n')) {
      el.append('\n');
    }
  });

  doc.querySelectorAll('[data-tex],[data-latex]').forEach((el) => {
    const tex = el.getAttribute('data-tex') || el.getAttribute('data-latex');
    if (!tex) return;
    const isDisplay = el.classList.contains('katex-display') || el.closest('.katex-display');
    el.replaceWith(isDisplay ? `$$${tex}$$` : `$${tex}$`);
  });

  doc.querySelectorAll('annotation[encoding="application/x-tex"]').forEach((el) => {
    const tex = (el.textContent || '').trim();
    if (!tex) return;
    const isDisplay = !!el.closest('.katex-display');
    const replacement = isDisplay ? `$$${tex}$$` : `$${tex}$`;
    const root = el.closest('.katex-display, .katex, math') || el;
    root.replaceWith(replacement);
  });

  const text = doc.body.textContent || '';
  return text.replace(/\r\n/g, '\n').trimEnd();
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

export function scrollToAnnotationRef(annotationId) {
  const previewTab = document.querySelector('#notes-tab-bar [data-tab="preview"]');
  previewTab?.click();

  setTimeout(() => {
    const preview = $('#note-preview');
    const ref = preview?.querySelector(`[data-annotation-id="${annotationId}"]`);
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
      ref.classList.add('outline-jump-highlight');
      setTimeout(() => ref.classList.remove('outline-jump-highlight'), 1500);
    }
  }, 100);
}

export async function jumpToNoteByAnnotation(annotation) {
  if (annotation.noteId) {
    const noteExists = notes.find((n) => n.id === annotation.noteId);
    if (noteExists) {
      await switchToNote(annotation.noteId);
      scrollToAnnotationRef(annotation.id);
      return;
    }
  }

  for (const note of notes) {
    if (note.linkedAnnotationIds && note.linkedAnnotationIds.includes(annotation.id)) {
      await switchToNote(note.id);
      scrollToAnnotationRef(annotation.id);
      return;
    }
    if (note.content && note.content.includes(annotation.id)) {
      await switchToNote(note.id);
      scrollToAnnotationRef(annotation.id);
      return;
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function getCurrentNote() {
  return currentNote;
}

export function getNotes() {
  return notes;
}
