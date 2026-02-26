
import { $, createElement, formatFileSize, formatDate } from '../utils/dom.js';
import * as storage from './storage.js';

let pdfs = [];
let currentPdfId = null;

let onPdfSelected = null;
let onPdfDeleted = null;
let onPdfRenamed = null;

export async function initLibrary(callbacks = {}) {
    onPdfSelected = callbacks.onPdfSelected;
    onPdfDeleted = callbacks.onPdfDeleted;
    onPdfRenamed = callbacks.onPdfRenamed;

    pdfs = await storage.getAllPdfs();
    renderList();

    $('#btn-import-pdf').addEventListener('click', () => {
        $('#file-input').click();
    });
    $('#btn-import-bundle')?.addEventListener('click', importBundleDirectory);

    $('#file-input').addEventListener('change', handleFileSelect);

    setupDragDrop();
}

async function handleFileSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    for (const file of files) {
        await importPdf(file);
    }
    e.target.value = '';
}

async function importPdf(file) {
    const arrayBuffer = await file.arrayBuffer();

    const fileNameKey = normalizePdfName(file.name).toLowerCase();
    const existing = pdfs.find((p) => normalizePdfName(p.name).toLowerCase() === fileNameKey);
    const pdfRecord = await storage.addPdf({
        id: existing?.id || undefined,
        name: file.name,
        data: arrayBuffer,
        size: file.size
    });

    if (!existing) {
        pdfs.push(pdfRecord);
    } else {
        const idx = pdfs.findIndex(p => p.id === existing.id);
        pdfs[idx] = { ...pdfRecord };
    }

    renderList();

    selectPdf(pdfRecord.id);
}

async function importBundleDirectory() {
    if (!('showDirectoryPicker' in window)) {
        alert('当前浏览器不支持目录导入，请使用 Chrome 或 Edge');
        return;
    }

    let dirHandle = null;
    try {
        dirHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('选择目录失败:', e);
        }
        return;
    }

    const importedPdfIds = [];
    let importedMdOnly = 0;
    try {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'directory') {
                const result = await importBundleFolder(entry);
                const id = result?.pdfId || null;
                importedMdOnly += result?.mdOnlyCount || 0;
                if (id) importedPdfIds.push(id);
            } else if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) {
                const id = await importBundleRootPdf(entry, dirHandle);
                if (id) importedPdfIds.push(id);
            }
        }
    } catch (err) {
        console.error('导入导出包失败:', err);
        alert('导入失败，请检查目录结构');
        return;
    }

    renderList();
    if (importedPdfIds.length > 0) {
        await selectPdf(importedPdfIds[0]);
        alert(`导入完成：${importedPdfIds.length} 篇文献${importedMdOnly ? `，并导入 ${importedMdOnly} 个 Markdown 文件` : ''}`);
    } else if (importedMdOnly > 0) {
        alert(`已导入 ${importedMdOnly} 个 Markdown 文件`);
    } else {
        alert('未发现可导入内容');
    }
}

async function importBundleRootPdf(pdfEntry, dirHandle) {
    const file = await pdfEntry.getFile();
    const id = await upsertPdfFromFile(file);
    if (!id) return null;
    await importMdFilesForPdf(dirHandle, id);
    return id;
}

async function importBundleFolder(folderHandle) {
    let pdfFile = null;
    for await (const entry of folderHandle.values()) {
        if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) {
            pdfFile = await entry.getFile();
            break;
        }
    }
    if (!pdfFile) {
        if (!currentPdfId) return { pdfId: null, mdOnlyCount: 0 };
        const mdOnlyCount = await importMdFilesForPdf(folderHandle, currentPdfId);
        return { pdfId: null, mdOnlyCount };
    }

    const pdfId = await upsertPdfFromFile(pdfFile);
    if (!pdfId) return null;

    await importMdFilesForPdf(folderHandle, pdfId);
    return { pdfId, mdOnlyCount: 0 };
}

async function upsertPdfFromFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const fileNameKey = normalizePdfName(file.name).toLowerCase();
    const existing = pdfs.find((p) => normalizePdfName(p.name).toLowerCase() === fileNameKey);
    const pdfRecord = await storage.addPdf({
        id: existing?.id || undefined,
        name: file.name,
        data: arrayBuffer,
        size: file.size
    });

    if (!existing) {
        pdfs.push(pdfRecord);
    } else {
        const idx = pdfs.findIndex((p) => p.id === existing.id);
        pdfs[idx] = { ...pdfRecord };
    }
    return pdfRecord.id;
}

async function importMdFilesForPdf(dirHandle, pdfId) {
    const existingNotes = await storage.getNotesByPdf(pdfId);
    const noteByTitle = new Map(existingNotes.map((n) => [n.title, n]));
    const existingSummary = await storage.getSummaryByPdf(pdfId);

    let imported = 0;
    for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file' || !/\.md$/i.test(entry.name)) continue;

        const file = await entry.getFile();
        const content = await file.text();
        const title = entry.name.replace(/\.md$/i, '').trim();
        if (!title) continue;

        if (title === '文献总结') {
            if (existingSummary) {
                existingSummary.title = '文献总结';
                existingSummary.content = content;
                await storage.updateSummary(existingSummary);
            } else {
                await storage.addSummary({
                    pdfId,
                    title: '文献总结',
                    content
                });
            }
            imported += 1;
            continue;
        }

        if (title === '全文翻译') {
            await storage.setSetting(`translationFulltextDoc:${pdfId}`, content);
            imported += 1;
            continue;
        }

        const note = noteByTitle.get(title);
        if (note) {
            note.content = content;
            await storage.updateNote(note);
        } else {
            const added = await storage.addNote({
                pdfId,
                title,
                content,
                linkedAnnotationIds: []
            });
            noteByTitle.set(title, added);
        }
        imported += 1;
    }
    return imported;
}

function setupDragDrop() {
    const dropZone = $('#pdf-drop-zone');
    const sidebar = $('#sidebar-left');

    ['dragenter', 'dragover'].forEach(event => {
        sidebar.addEventListener(event, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach(event => {
        sidebar.addEventListener(event, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('drag-over');
        });
    });

    sidebar.addEventListener('drop', async (e) => {
        const files = Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf');
        for (const file of files) {
            await importPdf(file);
        }
    });
}

export async function selectPdf(pdfId) {
    currentPdfId = pdfId;
    await storage.updatePdfLastOpened(pdfId);

    document.querySelectorAll('.pdf-item').forEach(el => {
        el.classList.toggle('active', el.dataset.pdfId === pdfId);
    });

    if (onPdfSelected) {
        const pdfData = await storage.getPdfData(pdfId);
        const meta = pdfs.find(p => p.id === pdfId);
        onPdfSelected(pdfData, meta);
    }
}

function renderList() {
    const list = $('#pdf-list');
    list.innerHTML = '';

    const sorted = [...pdfs].sort((a, b) => {
        return new Date(b.lastOpenedAt || b.addedAt) - new Date(a.lastOpenedAt || a.addedAt);
    });

    for (const pdf of sorted) {
        const item = createElement('div', {
            className: `pdf-item ${pdf.id === currentPdfId ? 'active' : ''}`,
            'data-pdf-id': pdf.id,
            onClick: () => selectPdf(pdf.id)
        }, [
            createElement('div', { className: 'pdf-item-info' }, [
                createElement('div', { className: 'pdf-item-name', textContent: pdf.name }),
                createElement('div', {
                    className: 'pdf-item-meta',
                    textContent: `${formatFileSize(pdf.size)} · ${formatDate(pdf.addedAt)}`
                })
            ])
        ]);

        const actions = createElement('div', { className: 'pdf-item-actions' }, [
            createElement('button', {
                className: 'pdf-item-rename',
                textContent: '✎',
                title: '重命名文献',
                onClick: (e) => {
                    e.stopPropagation();
                    renamePdf(pdf.id);
                }
            }),
            createElement('button', {
                className: 'pdf-item-delete',
                textContent: '🗑',
                title: '删除文献',
                onClick: (e) => {
                    e.stopPropagation();
                    deletePdf(pdf.id, pdf.name);
                }
            })
        ]);

        const row = createElement('div', { className: 'pdf-item-row' }, [item, actions]);
        row.dataset.pdfId = pdf.id;
        list.appendChild(row);
    }
}

async function deletePdf(pdfId, pdfName) {
    if (!confirm(`确定删除“${pdfName}”以及其所有标注和笔记吗？`)) return;

    await storage.deletePdf(pdfId);
    pdfs = pdfs.filter(p => p.id !== pdfId);
    renderList();

    if (currentPdfId === pdfId) {
        currentPdfId = null;
        if (onPdfDeleted) onPdfDeleted();
    }
}

async function renamePdf(pdfId) {
    const target = pdfs.find((p) => p.id === pdfId);
    if (!target) return;

    const input = window.prompt('请输入新的文献名称', target.name || '');
    if (input === null) return;

    const nextName = normalizePdfName(input);
    if (!nextName) {
        alert('文献名不能为空');
        return;
    }

    const duplicate = pdfs.some((p) => p.id !== pdfId && normalizePdfName(p.name).toLowerCase() === nextName.toLowerCase());
    if (duplicate) {
        alert('已存在同名文献，请使用其他名称');
        return;
    }

    await storage.renamePdf(pdfId, nextName);
    await storage.renameSummaryCardPdfName(pdfId, nextName);

    const idx = pdfs.findIndex((p) => p.id === pdfId);
    if (idx >= 0) {
        pdfs[idx] = { ...pdfs[idx], name: nextName };
    }
    renderList();

    if (onPdfRenamed) {
        await onPdfRenamed(pdfId, nextName);
    }
}

function normalizePdfName(raw) {
    return String(raw || '').trim().replace(/\.pdf$/i, '').trim();
}

export function getPdfMeta(pdfId) {
    return pdfs.find(p => p.id === pdfId);
}

export function getCurrentPdfId() { return currentPdfId; }
export function getPdfList() { return pdfs; }
