/**
 * global-notes.js — 全局笔记模块
 *
 * 提供独立于 PDF 的全局 Markdown 笔记功能
 * 支持多笔记管理、左右分栏实时预览、自动保存到 IndexedDB + 文件系统
 */

import { $, debounce } from '../utils/dom.js';
import { renderMarkdown } from '../utils/markdown.js';
import { attachMarkdownToolbar } from '../utils/markdown-toolbar.js';
import { exportGlobalNoteToDir, getLastExportError } from '../utils/export.js';
import * as storage from './storage.js';

let notes = [];
let currentNote = null;
let globalNotesDirHandle = null;
let fileWriteChain = Promise.resolve();

const LAST_NOTE_KEY = 'globalNotesLastNoteId';
const TOC_COLLAPSED_KEY = 'globalNotesTocCollapsed';
let tocCollapsed = false;

const autoSaveDebounced = debounce(async () => {
    await saveCurrentNote();
}, 500);

/**
 * 初始化全局笔记模块
 */
export function initGlobalNotes() {
    tocCollapsed = localStorage.getItem(TOC_COLLAPSED_KEY) === '1';
    bindModalEvents();
    bindToolbarEvents();
    bindEditorEvents();
    bindTocEvents();
}

// ==================== Modal 控制 ====================

function bindModalEvents() {
    $('#btn-global-notes')?.addEventListener('click', () => openModal());
    $('#btn-close-global-notes')?.addEventListener('click', () => closeModal());

    const modal = $('#global-notes-modal');
    modal?.querySelector('.modal-overlay')?.addEventListener('click', () => closeModal());

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.style.display !== 'none') {
            closeModal();
        }
    });
}

async function openModal() {
    const modal = $('#global-notes-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    await loadNotesList();

    // 恢复上次选择的笔记
    const lastId = localStorage.getItem(LAST_NOTE_KEY);
    if (lastId && notes.find(n => n.id === lastId)) {
        await switchToNote(lastId);
    } else if (notes.length > 0) {
        await switchToNote(notes[0].id);
    } else {
        clearEditor();
    }

    // 延迟附加 Markdown 工具栏，确保 textarea 已渲染
    const editor = $('#global-note-editor');
    if (editor && !editor._mdToolbarAttached) {
        attachMarkdownToolbar(editor);
        editor._mdToolbarAttached = true;
    }

    // 恢复目录句柄并显示路径
    await restoreDirHandle();
    updateDirDisplay();
}

function closeModal() {
    const modal = $('#global-notes-modal');
    if (!modal) return;
    modal.style.display = 'none';
}

// ==================== 笔记列表管理 ====================

function bindToolbarEvents() {
    $('#btn-new-global-note')?.addEventListener('click', () => createNote());
    $('#btn-rename-global-note')?.addEventListener('click', () => renameNote());
    $('#btn-delete-global-note')?.addEventListener('click', () => deleteNote());
    $('#btn-global-notes-dir')?.addEventListener('click', () => chooseSaveDirectory());

    $('#global-note-select')?.addEventListener('change', async (e) => {
        const id = e.target.value;
        if (id) await switchToNote(id);
    });
}

async function loadNotesList() {
    notes = await storage.getAllGlobalNotes();
    renderNoteSelect();
}

function renderNoteSelect() {
    const select = $('#global-note-select');
    if (!select) return;
    select.innerHTML = '';

    if (notes.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '-- 暂无笔记 --';
        select.appendChild(opt);
        return;
    }

    for (const note of notes) {
        const opt = document.createElement('option');
        opt.value = note.id;
        opt.textContent = note.title;
        opt.selected = currentNote?.id === note.id;
        select.appendChild(opt);
    }
}

async function switchToNote(noteId) {
    const note = await storage.getGlobalNote(noteId);
    if (!note) return;

    currentNote = note;
    localStorage.setItem(LAST_NOTE_KEY, noteId);

    const editor = $('#global-note-editor');
    if (editor) editor.value = note.content || '';

    renderNoteSelect();
    updatePreview();
    updateToc();
}

async function createNote() {
    const title = prompt('请输入笔记名称：');
    if (!title || !title.trim()) return;

    const note = await storage.addGlobalNote({ title: title.trim() });
    notes.unshift(note);
    currentNote = note;
    localStorage.setItem(LAST_NOTE_KEY, note.id);

    renderNoteSelect();
    const editor = $('#global-note-editor');
    if (editor) editor.value = '';
    updatePreview();
    updateToc();
}

async function renameNote() {
    if (!currentNote) {
        alert('请先选择一个笔记');
        return;
    }
    const newTitle = prompt('请输入新的笔记名称：', currentNote.title);
    if (!newTitle || !newTitle.trim() || newTitle.trim() === currentNote.title) return;

    currentNote.title = newTitle.trim();
    await storage.updateGlobalNote(currentNote);
    await loadNotesList();
    renderNoteSelect();
}

async function deleteNote() {
    if (!currentNote) {
        alert('请先选择一个笔记');
        return;
    }
    if (!confirm(`确定删除笔记"${currentNote.title}"吗？`)) return;

    await storage.deleteGlobalNote(currentNote.id);
    currentNote = null;
    await loadNotesList();

    if (notes.length > 0) {
        await switchToNote(notes[0].id);
    } else {
        clearEditor();
        localStorage.removeItem(LAST_NOTE_KEY);
    }
}

function clearEditor() {
    const editor = $('#global-note-editor');
    const preview = $('#global-note-preview');
    if (editor) editor.value = '';
    if (preview) preview.innerHTML = '<p class="empty-hint">新建或选择一个笔记开始编写</p>';
}

// ==================== 编辑与预览 ====================

function bindEditorEvents() {
    const editor = $('#global-note-editor');
    if (!editor) return;

    editor.addEventListener('input', () => {
        updatePreview();
        updateToc();
        autoSaveDebounced();
    });
}

function updatePreview() {
    const preview = $('#global-note-preview');
    const editor = $('#global-note-editor');
    if (!preview || !editor) return;

    const content = editor.value || '';
    if (!content.trim()) {
        preview.innerHTML = '<p class="empty-hint">预览区域</p>';
        return;
    }
    preview.innerHTML = renderMarkdown(content);
    recoverInvisibleMath(preview);
}

// ==================== 目录（TOC） ====================

function bindTocEvents() {
    $('#btn-toggle-global-toc')?.addEventListener('click', () => toggleToc());
}

function toggleToc() {
    tocCollapsed = !tocCollapsed;
    localStorage.setItem(TOC_COLLAPSED_KEY, tocCollapsed ? '1' : '0');
    applyTocState();
}

function applyTocState() {
    const pane = $('#global-notes-toc-pane');
    const divider = document.querySelector('.global-notes-toc-divider');
    const btn = $('#btn-toggle-global-toc');
    if (!pane) return;

    pane.classList.toggle('collapsed', tocCollapsed);
    if (divider) divider.classList.toggle('collapsed', tocCollapsed);
    if (btn) {
        btn.textContent = tocCollapsed ? '▶' : '◀';
        btn.title = tocCollapsed ? '展开目录' : '收起目录';
    }
}

function extractHeadings(content) {
    if (!content) return [];
    const lines = content.split('\n');
    const headings = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        const match = line.match(/^(#{1,3})\s+(.+)$/);
        if (match) {
            headings.push({
                level: match[1].length,
                text: match[2].trim(),
                line: i
            });
        }
    }
    return headings;
}

function updateToc() {
    const list = $('#global-notes-toc-list');
    if (!list) return;

    const editor = $('#global-note-editor');
    const content = editor?.value || '';
    const headings = extractHeadings(content);

    applyTocState();

    if (headings.length === 0) {
        list.innerHTML = '<div class="global-notes-toc-empty">暂无目录</div>';
        return;
    }

    list.innerHTML = '';
    headings.forEach((h, idx) => {
        const item = document.createElement('div');
        item.className = `global-notes-toc-item toc-level-${h.level}`;
        item.textContent = h.text;
        item.title = h.text;
        item.dataset.tocIdx = idx;
        item.addEventListener('click', () => {
            setActiveTocItem(list, idx);
            scrollToHeading(h);
        });
        list.appendChild(item);
    });
}

function setActiveTocItem(list, activeIdx) {
    list.querySelectorAll('.global-notes-toc-item').forEach((el) => {
        el.classList.toggle('active', Number(el.dataset.tocIdx) === activeIdx);
    });
}

function scrollToHeading(heading) {
    // 滚动编辑器到对应行
    const editor = $('#global-note-editor');
    if (editor) {
        const lines = editor.value.split('\n');
        let charIdx = 0;
        for (let i = 0; i < heading.line && i < lines.length; i++) {
            charIdx += lines[i].length + 1; // +1 for '\n'
        }
        editor.focus();
        editor.setSelectionRange(charIdx, charIdx);

        // 计算行高度来滚动
        const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
        const scrollTop = heading.line * lineHeight - editor.clientHeight / 4;
        editor.scrollTop = Math.max(0, scrollTop);
    }

    // 滚动预览区到对应标题
    const preview = $('#global-note-preview');
    if (preview) {
        const hTags = preview.querySelectorAll('h1, h2, h3');
        // 找到文本匹配的标题元素
        const cleanText = (t) => (t || '').replace(/\s+/g, ' ').trim();
        const targetText = cleanText(heading.text);

        // 根据顺序索引查找（同名标题时区分）
        const allHeadings = extractHeadings($('#global-note-editor')?.value || '');
        const matchIndex = allHeadings.filter(
            (h, idx) => idx < allHeadings.indexOf(heading) && cleanText(h.text) === targetText
        ).length;

        let found = 0;
        for (const el of hTags) {
            if (cleanText(el.textContent) === targetText) {
                if (found === matchIndex) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    break;
                }
                found++;
            }
        }
    }
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

// ==================== 自动保存 ====================

async function saveCurrentNote() {
    if (!currentNote) return;

    const editor = $('#global-note-editor');
    if (!editor) return;

    currentNote.content = editor.value;

    try {
        await storage.updateGlobalNote(currentNote);
        showSaveStatus('已保存');

        // 自动导出到文件系统
        await autoExportToDir();
    } catch (err) {
        console.warn('全局笔记保存失败:', err);
        showSaveStatus('保存失败', true);
    }
}

async function autoExportToDir() {
    if (!globalNotesDirHandle || !currentNote) return;

    try {
        const permission = await globalNotesDirHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') return;

        fileWriteChain = fileWriteChain.then(async () => {
            const ok = await exportGlobalNoteToDir(
                globalNotesDirHandle,
                currentNote.title,
                currentNote.content || ''
            );
            if (!ok) {
                console.warn('全局笔记文件导出失败:', getLastExportError());
            }
        }).catch((err) => {
            console.warn('全局笔记文件写入失败:', err);
        });

        await fileWriteChain;
    } catch (err) {
        console.warn('全局笔记目录权限检查失败:', err);
    }
}

// ==================== 保存状态显示 ====================

function showSaveStatus(message, isError = false) {
    const el = $('#global-notes-save-status');
    if (!el) return;

    const time = new Date().toLocaleTimeString();
    el.textContent = `${message} ${time}`;
    el.classList.toggle('error', isError);
    el.classList.add('visible');

    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
        el.classList.remove('visible');
    }, 4000);
}

// ==================== 目录句柄管理 ====================

async function restoreDirHandle() {
    const savedHandle = await storage.getSetting('globalNotesDirHandle');
    if (savedHandle) {
        globalNotesDirHandle = savedHandle;
    }
}

async function chooseSaveDirectory() {
    if (!('showDirectoryPicker' in window)) {
        alert('您的浏览器不支持目录选择功能，请使用 Chrome 或 Edge 浏览器。');
        return;
    }
    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        globalNotesDirHandle = handle;
        await storage.setSetting('globalNotesDirHandle', handle);
        updateDirDisplay();
        showSaveStatus('目录已设置');
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('选择目录失败:', e);
        }
    }
}

function updateDirDisplay() {
    const el = $('#global-notes-dir-display');
    if (!el) return;
    if (globalNotesDirHandle) {
        el.textContent = globalNotesDirHandle.name;
        el.title = `保存目录: ${globalNotesDirHandle.name}/全局笔记/`;
    } else {
        el.textContent = '未设置保存目录';
        el.title = '点击📁按钮选择保存目录';
    }
}

/**
 * 供外部调用：设置全局笔记存储目录
 */
export async function setGlobalNotesDirHandle(handle) {
    globalNotesDirHandle = handle;
    await storage.setSetting('globalNotesDirHandle', handle);

    // 请求写入权限
    try {
        await handle.requestPermission({ mode: 'readwrite' });
    } catch (e) {
        console.warn('全局笔记目录权限请求失败:', e);
    }
    updateDirDisplay();
}
