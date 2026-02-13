/**
 * library.js — 文献库管理模块
 * 
 * 处理 PDF 导入、列表展示、切换、删除
 */

import { $, createElement, formatFileSize, formatDate } from '../utils/dom.js';
import * as storage from './storage.js';

let pdfs = [];
let currentPdfId = null;

// 回调
let onPdfSelected = null;
let onPdfDeleted = null;

/**
 * 初始化文献库
 */
export async function initLibrary(callbacks = {}) {
    onPdfSelected = callbacks.onPdfSelected;
    onPdfDeleted = callbacks.onPdfDeleted;

    // 加载 PDF 列表
    pdfs = await storage.getAllPdfs();
    renderList();

    // 导入按钮
    $('#btn-import-pdf').addEventListener('click', () => {
        $('#file-input').click();
    });

    // 文件选择
    $('#file-input').addEventListener('change', handleFileSelect);

    // 拖放
    setupDragDrop();
}

/**
 * 处理文件选择
 */
async function handleFileSelect(e) {
    const files = Array.from(e.target.files).filter(f => f.type === 'application/pdf');
    for (const file of files) {
        await importPdf(file);
    }
    e.target.value = ''; // 重置
}

/**
 * 导入 PDF 文件
 */
async function importPdf(file) {
    const arrayBuffer = await file.arrayBuffer();

    // 检查是否已存在同名文件
    const existing = pdfs.find(p => p.name === file.name);
    const pdfRecord = await storage.addPdf({
        id: existing?.id || undefined,
        name: file.name,
        data: arrayBuffer,
        size: file.size
    });

    if (!existing) {
        pdfs.push(pdfRecord);
    } else {
        // 更新元数据
        const idx = pdfs.findIndex(p => p.id === existing.id);
        pdfs[idx] = { ...pdfRecord };
    }

    renderList();

    // 自动打开新导入的 PDF
    selectPdf(pdfRecord.id);
}

/**
 * 设置拖放区域
 */
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

/**
 * 选择 PDF
 */
export async function selectPdf(pdfId) {
    currentPdfId = pdfId;
    await storage.updatePdfLastOpened(pdfId);

    // 更新选中状态
    document.querySelectorAll('.pdf-item').forEach(el => {
        el.classList.toggle('active', el.dataset.pdfId === pdfId);
    });

    if (onPdfSelected) {
        const pdfData = await storage.getPdfData(pdfId);
        const meta = pdfs.find(p => p.id === pdfId);
        onPdfSelected(pdfData, meta);
    }
}

/**
 * 渲染文献列表
 */
function renderList() {
    const list = $('#pdf-list');
    list.innerHTML = '';

    // 按最近打开时间排序
    const sorted = [...pdfs].sort((a, b) => {
        return new Date(b.lastOpenedAt || b.addedAt) - new Date(a.lastOpenedAt || a.addedAt);
    });

    for (const pdf of sorted) {
        const item = createElement('div', {
            className: `pdf-item ${pdf.id === currentPdfId ? 'active' : ''}`,
            'data-pdf-id': pdf.id,
            onClick: () => selectPdf(pdf.id)
        }, [
            createElement('span', { className: 'pdf-item-icon', textContent: '📄' }),
            createElement('div', { className: 'pdf-item-info' }, [
                createElement('div', { className: 'pdf-item-name', textContent: pdf.name }),
                createElement('div', {
                    className: 'pdf-item-meta',
                    textContent: `${formatFileSize(pdf.size)} · ${formatDate(pdf.addedAt)}`
                })
            ]),
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

        // 设置 data attribute
        item.dataset.pdfId = pdf.id;
        list.appendChild(item);
    }
}

/**
 * 删除 PDF
 */
async function deletePdf(pdfId, pdfName) {
    if (!confirm(`确定删除「${pdfName}」以及其所有标注和笔记吗？`)) return;

    await storage.deletePdf(pdfId);
    pdfs = pdfs.filter(p => p.id !== pdfId);
    renderList();

    if (currentPdfId === pdfId) {
        currentPdfId = null;
        if (onPdfDeleted) onPdfDeleted();
    }
}

/**
 * 获取 PDF 元数据
 */
export function getPdfMeta(pdfId) {
    return pdfs.find(p => p.id === pdfId);
}

export function getCurrentPdfId() { return currentPdfId; }
export function getPdfList() { return pdfs; }
