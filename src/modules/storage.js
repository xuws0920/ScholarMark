/**
 * storage.js — IndexedDB 数据持久化模块
 * 
 * 管理 PDF 文件、标注、笔记的增删改查
 */

const DB_NAME = 'ScholarMarkDB';
const DB_VERSION = 2;

let db = null;

/**
 * 初始化 IndexedDB
 */
export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // PDF 文件表
            if (!database.objectStoreNames.contains('pdfs')) {
                const pdfStore = database.createObjectStore('pdfs', { keyPath: 'id' });
                pdfStore.createIndex('name', 'name', { unique: false });
                pdfStore.createIndex('addedAt', 'addedAt', { unique: false });
            }

            // 标注表
            if (!database.objectStoreNames.contains('annotations')) {
                const annStore = database.createObjectStore('annotations', { keyPath: 'id' });
                annStore.createIndex('pdfId', 'pdfId', { unique: false });
                annStore.createIndex('page', 'page', { unique: false });
                annStore.createIndex('noteId', 'noteId', { unique: false });
                annStore.createIndex('pdfId_page', ['pdfId', 'page'], { unique: false });
            }

            // 笔记表
            if (!database.objectStoreNames.contains('notes')) {
                const noteStore = database.createObjectStore('notes', { keyPath: 'id' });
                noteStore.createIndex('pdfId', 'pdfId', { unique: false });
            }

            // 文献总结表（每篇 PDF 一条）
            if (!database.objectStoreNames.contains('summaries')) {
                const summaryStore = database.createObjectStore('summaries', { keyPath: 'id' });
                summaryStore.createIndex('pdfId', 'pdfId', { unique: true });
            }

            // 设置表
            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
    });
}

// ==================== PDF 相关 ====================

export function addPdf(pdfData) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readwrite');
        const store = tx.objectStore('pdfs');
        const record = {
            id: pdfData.id || generateId(),
            name: pdfData.name,
            data: pdfData.data, // ArrayBuffer
            size: pdfData.size,
            addedAt: new Date().toISOString(),
            lastOpenedAt: new Date().toISOString()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getAllPdfs() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readonly');
        const store = tx.objectStore('pdfs');
        const req = store.getAll();
        req.onsuccess = () => {
            // 返回时不包含 data 以减少内存占用，需要时再单独获取
            const list = req.result.map(p => ({
                id: p.id,
                name: p.name,
                size: p.size,
                addedAt: p.addedAt,
                lastOpenedAt: p.lastOpenedAt
            }));
            resolve(list);
        };
        req.onerror = () => reject(req.error);
    });
}

export function getPdfData(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readonly');
        const store = tx.objectStore('pdfs');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export function deletePdf(id) {
    return new Promise(async (resolve, reject) => {
        try {
            // 删除关联的标注和笔记
            const annotations = await getAnnotationsByPdf(id);
            const notes = await getNotesByPdf(id);
            const summary = await getSummaryByPdf(id);

            const tx = db.transaction(['pdfs', 'annotations', 'notes', 'summaries'], 'readwrite');
            tx.objectStore('pdfs').delete(id);
            for (const ann of annotations) {
                tx.objectStore('annotations').delete(ann.id);
            }
            for (const note of notes) {
                tx.objectStore('notes').delete(note.id);
            }
            if (summary) {
                tx.objectStore('summaries').delete(summary.id);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        } catch (e) {
            reject(e);
        }
    });
}

export function updatePdfLastOpened(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readwrite');
        const store = tx.objectStore('pdfs');
        const req = store.get(id);
        req.onsuccess = () => {
            const record = req.result;
            if (record) {
                record.lastOpenedAt = new Date().toISOString();
                store.put(record);
            }
            resolve();
        };
        req.onerror = () => reject(req.error);
    });
}

// ==================== 标注相关 ====================

export function addAnnotation(annotation) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('annotations', 'readwrite');
        const store = tx.objectStore('annotations');
        const record = {
            id: annotation.id || generateId(),
            pdfId: annotation.pdfId,
            page: annotation.page,
            text: annotation.text,
            anchorText: annotation.anchorText || annotation.text || '',
            displayTextMd: annotation.displayTextMd || '',
            questionMd: annotation.questionMd || '',
            color: annotation.color,
            rects: annotation.rects, // 高亮区域坐标数组 [{x, y, w, h}]
            noteId: annotation.noteId || null,
            createdAt: new Date().toISOString()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getAnnotationsByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('annotations', 'readonly');
        const store = tx.objectStore('annotations');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export function updateAnnotation(annotation) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('annotations', 'readwrite');
        const store = tx.objectStore('annotations');
        const req = store.put(annotation);
        req.onsuccess = () => resolve(annotation);
        req.onerror = () => reject(req.error);
    });
}

export function deleteAnnotation(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('annotations', 'readwrite');
        const store = tx.objectStore('annotations');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export function getAnnotation(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('annotations', 'readonly');
        const store = tx.objectStore('annotations');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ==================== 笔记相关 ====================

export function addNote(note) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const record = {
            id: note.id || generateId(),
            pdfId: note.pdfId,
            title: note.title || '未命名笔记',
            content: note.content || '',
            linkedAnnotationIds: note.linkedAnnotationIds || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getNotesByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export function getNote(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const store = tx.objectStore('notes');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export function updateNote(note) {
    return new Promise((resolve, reject) => {
        note.updatedAt = new Date().toISOString();
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const req = store.put(note);
        req.onsuccess = () => resolve(note);
        req.onerror = () => reject(req.error);
    });
}

export function deleteNote(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readwrite');
        const store = tx.objectStore('notes');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ==================== 文献总结相关 ====================

export function addSummary(summary) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaries', 'readwrite');
        const store = tx.objectStore('summaries');
        const record = {
            id: summary.id || generateId(),
            pdfId: summary.pdfId,
            title: summary.title || '文献总结',
            content: summary.content || '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getSummaryByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaries', 'readonly');
        const store = tx.objectStore('summaries');
        const index = store.index('pdfId');
        const req = index.get(pdfId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function updateSummary(summary) {
    return new Promise((resolve, reject) => {
        summary.updatedAt = new Date().toISOString();
        const tx = db.transaction('summaries', 'readwrite');
        const store = tx.objectStore('summaries');
        const req = store.put(summary);
        req.onsuccess = () => resolve(summary);
        req.onerror = () => reject(req.error);
    });
}

export function deleteSummary(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaries', 'readwrite');
        const store = tx.objectStore('summaries');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ==================== 设置相关 ====================

export function getSetting(key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
    });
}

export function setSetting(key, value) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ==================== 搜索 ====================

export async function searchAll(query) {
    const q = query.toLowerCase();
    const results = { annotations: [], notes: [] };

    // 搜索标注
    const allAnnotations = await new Promise((resolve, reject) => {
        const tx = db.transaction('annotations', 'readonly');
        const req = tx.objectStore('annotations').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    results.annotations = allAnnotations.filter((a) => {
        const text = (a.text || '').toLowerCase();
        const displayTextMd = (a.displayTextMd || '').toLowerCase();
        const questionMd = (a.questionMd || '').toLowerCase();
        return text.includes(q) || displayTextMd.includes(q) || questionMd.includes(q);
    });

    // 搜索笔记
    const allNotes = await new Promise((resolve, reject) => {
        const tx = db.transaction('notes', 'readonly');
        const req = tx.objectStore('notes').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    results.notes = allNotes.filter(n =>
        (n.title && n.title.toLowerCase().includes(q)) ||
        (n.content && n.content.toLowerCase().includes(q))
    );

    return results;
}

// ==================== 工具函数 ====================

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export { generateId };
