/**
 * storage.js — IndexedDB 数据持久化模块
 * 
 * 管理 PDF 文件、标注、笔记的增删改查
 */

const DB_NAME = 'ScholarMarkDB';
const DB_VERSION = 7;

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

            if (!database.objectStoreNames.contains('summaryCards')) {
                const cardStore = database.createObjectStore('summaryCards', { keyPath: 'id' });
                cardStore.createIndex('pdfId', 'pdfId', { unique: true });
                cardStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            // 设置表
            if (!database.objectStoreNames.contains('figureClips')) {
                const clipStore = database.createObjectStore('figureClips', { keyPath: 'id' });
                clipStore.createIndex('pdfId', 'pdfId', { unique: false });
                clipStore.createIndex('pdfId_page', ['pdfId', 'page'], { unique: false });
                clipStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('translations')) {
                const translationStore = database.createObjectStore('translations', { keyPath: 'id' });
                translationStore.createIndex('pdfId', 'pdfId', { unique: false });
                translationStore.createIndex('pdfId_page', ['pdfId', 'page'], { unique: false });
                translationStore.createIndex('sourceType', 'sourceType', { unique: false });
                translationStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('translationCache')) {
                const cacheStore = database.createObjectStore('translationCache', { keyPath: 'id' });
                cacheStore.createIndex('pdfId', 'pdfId', { unique: false });
                cacheStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('translationJobs')) {
                const jobsStore = database.createObjectStore('translationJobs', { keyPath: 'id' });
                jobsStore.createIndex('pdfId', 'pdfId', { unique: false });
                jobsStore.createIndex('status', 'status', { unique: false });
                jobsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('mediaAssets')) {
                const mediaStore = database.createObjectStore('mediaAssets', { keyPath: 'id' });
                mediaStore.createIndex('pdfId', 'pdfId', { unique: false });
                mediaStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('mediaLinks')) {
                const mediaLinksStore = database.createObjectStore('mediaLinks', { keyPath: 'id' });
                mediaLinksStore.createIndex('assetId', 'assetId', { unique: false });
                mediaLinksStore.createIndex('pdfId', 'pdfId', { unique: false });
                mediaLinksStore.createIndex('pdf_doc', ['pdfId', 'docType', 'docId'], { unique: false });
                mediaLinksStore.createIndex('asset_doc', ['assetId', 'docType', 'docId'], { unique: true });
            }

            if (!database.objectStoreNames.contains('settings')) {
                database.createObjectStore('settings', { keyPath: 'key' });
            }

            if (!database.objectStoreNames.contains('graphs')) {
                const graphStore = database.createObjectStore('graphs', { keyPath: 'id' });
                graphStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            if (!database.objectStoreNames.contains('graphNodes')) {
                const nodeStore = database.createObjectStore('graphNodes', { keyPath: 'id' });
                nodeStore.createIndex('graphId', 'graphId', { unique: false });
                nodeStore.createIndex('docId', 'docId', { unique: false });
                nodeStore.createIndex('graphId_docId', ['graphId', 'docId'], { unique: true });
            }

            if (!database.objectStoreNames.contains('graphEdges')) {
                const edgeStore = database.createObjectStore('graphEdges', { keyPath: 'id' });
                edgeStore.createIndex('graphId', 'graphId', { unique: false });
                edgeStore.createIndex('sourceNodeId', 'sourceNodeId', { unique: false });
                edgeStore.createIndex('targetNodeId', 'targetNodeId', { unique: false });
                edgeStore.createIndex('graphId_source_target', ['graphId', 'sourceNodeId', 'targetNodeId'], { unique: true });
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
            const clips = await getFigureClipsByPdf(id);

            const card = await getSummaryCardByPdf(id);
            const translations = await getTranslationsByPdf(id);
            const jobs = await getTranslationJobsByPdf(id);
            const caches = await getTranslationCachesByPdf(id);
            const mediaAssets = await getMediaAssetsByPdf(id);
            const mediaLinks = await getMediaLinksByPdf(id);

            const tx = db.transaction(['pdfs', 'annotations', 'notes', 'summaries', 'figureClips', 'summaryCards', 'translations', 'translationJobs', 'translationCache', 'mediaAssets', 'mediaLinks'], 'readwrite');
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
            if (card) {
                tx.objectStore('summaryCards').delete(card.id);
            }
            for (const clip of clips) {
                tx.objectStore('figureClips').delete(clip.id);
            }
            for (const translation of translations) {
                tx.objectStore('translations').delete(translation.id);
            }
            for (const job of jobs) {
                tx.objectStore('translationJobs').delete(job.id);
            }
            for (const cache of caches) {
                tx.objectStore('translationCache').delete(cache.id);
            }
            for (const asset of mediaAssets) {
                tx.objectStore('mediaAssets').delete(asset.id);
            }
            for (const link of mediaLinks) {
                tx.objectStore('mediaLinks').delete(link.id);
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
        const now = new Date().toISOString();
        const record = {
            id: annotation.id || generateId(),
            pdfId: annotation.pdfId,
            page: annotation.page,
            text: annotation.text,
            anchorText: annotation.anchorText || annotation.text || '',
            displayTextMd: annotation.displayTextMd || '',
            questionMd: annotation.questionMd || '',
            color: annotation.color,
            style: annotation.style || 'highlight',
            comment: annotation.comment || '',
            entryMode: annotation.entryMode || null,
            rects: annotation.rects,
            noteId: annotation.noteId || null,
            createdAt: now,
            updatedAt: now
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

export function renamePdf(id, nextName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pdfs', 'readwrite');
        const store = tx.objectStore('pdfs');
        const req = store.get(id);
        req.onsuccess = () => {
            const record = req.result;
            if (!record) {
                reject(new Error('PDF not found'));
                return;
            }
            record.name = nextName;
            store.put(record);
            resolve(record);
        };
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

// ==================== 总结卡片相关 ====================

export async function upsertSummaryCard(card) {
    const existing = await getSummaryCardByPdf(card.pdfId);
    const now = new Date().toISOString();
    const record = {
        id: existing?.id || card.id || generateId(),
        pdfId: card.pdfId,
        pdfName: card.pdfName || '',
        content: card.content || '',
        thumbnailDataUrl: typeof card.thumbnailDataUrl === 'string'
            ? card.thumbnailDataUrl
            : (existing?.thumbnailDataUrl || ''),
        thumbnailUpdatedAt: typeof card.thumbnailDataUrl === 'string'
            ? now
            : (existing?.thumbnailUpdatedAt || null),
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaryCards', 'readwrite');
        const store = tx.objectStore('summaryCards');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export async function renameSummaryCardPdfName(pdfId, nextName) {
    const card = await getSummaryCardByPdf(pdfId);
    if (!card) return null;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaryCards', 'readwrite');
        const store = tx.objectStore('summaryCards');
        const next = { ...card, pdfName: nextName, updatedAt: new Date().toISOString() };
        const req = store.put(next);
        req.onsuccess = () => resolve(next);
        req.onerror = () => reject(req.error);
    });
}

export function getSummaryCardByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaryCards', 'readonly');
        const store = tx.objectStore('summaryCards');
        const index = store.index('pdfId');
        const req = index.get(pdfId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getAllSummaryCards() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('summaryCards', 'readonly');
        const store = tx.objectStore('summaryCards');
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

// ==================== 鍏抽敭鍥捐〃鎽樺綍 ====================

export function addFigureClip(clip) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('figureClips', 'readwrite');
        const store = tx.objectStore('figureClips');
        const record = {
            id: clip.id || generateId(),
            pdfId: clip.pdfId,
            page: clip.page,
            rect: clip.rect || null,
            imageDataUrl: clip.imageDataUrl || '',
            title: clip.title || '图表摘录',
            noteMd: clip.noteMd || '',
            tags: clip.tags || [],
            linkedAnnotationIds: clip.linkedAnnotationIds || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getFigureClipsByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('figureClips', 'readonly');
        const store = tx.objectStore('figureClips');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function updateFigureClip(clip) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('figureClips', 'readwrite');
        const store = tx.objectStore('figureClips');
        const next = { ...clip, updatedAt: new Date().toISOString() };
        const req = store.put(next);
        req.onsuccess = () => resolve(next);
        req.onerror = () => reject(req.error);
    });
}

export function deleteFigureClip(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('figureClips', 'readwrite');
        const store = tx.objectStore('figureClips');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ==================== 设置相关 ====================

export function addTranslation(translation) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translations', 'readwrite');
        const store = tx.objectStore('translations');
        const now = new Date().toISOString();
        const record = {
            id: translation.id || generateId(),
            pdfId: translation.pdfId,
            page: translation.page || 1,
            sourceType: translation.sourceType || 'image_clip',
            imageHash: translation.imageHash || '',
            sourceImageDataUrl: translation.sourceImageDataUrl || '',
            sourceText: translation.sourceText || '',
            bilingualMd: translation.bilingualMd || '',
            formulaNotes: translation.formulaNotes || '',
            terminologyWarnings: translation.terminologyWarnings || [],
            archivedToFulltext: !!translation.archivedToFulltext,
            provider: translation.provider || 'openai_compatible',
            model: translation.model || '',
            promptVersion: translation.promptVersion || 'v1',
            terminologyVersion: translation.terminologyVersion || 'v1',
            usage: translation.usage || null,
            error: translation.error || '',
            createdAt: now,
            updatedAt: now
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function updateTranslation(translation) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translations', 'readwrite');
        const store = tx.objectStore('translations');
        const next = { ...translation, updatedAt: new Date().toISOString() };
        const req = store.put(next);
        req.onsuccess = () => resolve(next);
        req.onerror = () => reject(req.error);
    });
}

export function deleteTranslation(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translations', 'readwrite');
        const store = tx.objectStore('translations');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export function getTranslation(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translations', 'readonly');
        const store = tx.objectStore('translations');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getTranslationsByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translations', 'readonly');
        const store = tx.objectStore('translations');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export async function upsertTranslationCache(cache) {
    const now = new Date().toISOString();
    const existing = await getTranslationCache(cache.id);
    const record = {
        id: cache.id,
        pdfId: cache.pdfId || '',
        page: cache.page || 1,
        imageHash: cache.imageHash || '',
        provider: cache.provider || 'openai_compatible',
        model: cache.model || '',
        promptVersion: cache.promptVersion || 'v1',
        terminologyVersion: cache.terminologyVersion || 'v1',
        bilingualMd: cache.bilingualMd || '',
        formulaNotes: cache.formulaNotes || '',
        terminologyWarnings: cache.terminologyWarnings || [],
        usage: cache.usage || null,
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationCache', 'readwrite');
        const store = tx.objectStore('translationCache');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getTranslationCache(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationCache', 'readonly');
        const store = tx.objectStore('translationCache');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getTranslationCachesByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationCache', 'readonly');
        const store = tx.objectStore('translationCache');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export async function upsertTranslationJob(job) {
    const now = new Date().toISOString();
    const existing = job?.id ? await getTranslationJob(job.id) : null;
    const record = {
        id: job.id || generateId(),
        pdfId: job.pdfId,
        mode: job.mode || 'fulltext_range',
        rangeStart: job.rangeStart || 1,
        rangeEnd: job.rangeEnd || 1,
        status: job.status || 'pending',
        progress: job.progress || { done: 0, total: 0, failedPages: [] },
        error: job.error || '',
        createdAt: existing?.createdAt || now,
        updatedAt: now
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationJobs', 'readwrite');
        const store = tx.objectStore('translationJobs');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getTranslationJob(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationJobs', 'readonly');
        const store = tx.objectStore('translationJobs');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getTranslationJobsByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationJobs', 'readonly');
        const store = tx.objectStore('translationJobs');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function deleteTranslationJob(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('translationJobs', 'readwrite');
        const store = tx.objectStore('translationJobs');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ==================== Graph Workspace ====================

export function createGraph(name) {
    const now = new Date().toISOString();
    const record = {
        id: generateId(),
        name: String(name || '').trim() || '未命名图谱',
        createdAt: now,
        updatedAt: now
    };

    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readwrite');
        const store = tx.objectStore('graphs');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getAllGraphs() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readonly');
        const store = tx.objectStore('graphs');
        const req = store.getAll();
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
        req.onerror = () => reject(req.error);
    });
}

export function getGraph(graphId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readonly');
        const store = tx.objectStore('graphs');
        const req = store.get(graphId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function updateGraph(graph) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphs', 'readwrite');
        const store = tx.objectStore('graphs');
        const next = { ...graph, updatedAt: new Date().toISOString() };
        const req = store.put(next);
        req.onsuccess = () => resolve(next);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteGraph(graphId) {
    const nodes = await getGraphNodes(graphId);
    const edges = await getGraphEdges(graphId);

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['graphs', 'graphNodes', 'graphEdges'], 'readwrite');
        tx.objectStore('graphs').delete(graphId);
        nodes.forEach((node) => tx.objectStore('graphNodes').delete(node.id));
        edges.forEach((edge) => tx.objectStore('graphEdges').delete(edge.id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export function getGraphNodes(graphId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphNodes', 'readonly');
        const store = tx.objectStore('graphNodes');
        const index = store.index('graphId');
        const req = index.getAll(graphId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function getGraphNode(nodeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphNodes', 'readonly');
        const store = tx.objectStore('graphNodes');
        const req = store.get(nodeId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getGraphNodeByDocId(graphId, docId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphNodes', 'readonly');
        const store = tx.objectStore('graphNodes');
        const index = store.index('graphId_docId');
        const req = index.get([graphId, docId]);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function addGraphNode(node) {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        const record = {
            id: node.id || generateId(),
            graphId: node.graphId,
            docId: node.docId,
            title: node.title || '',
            authors: node.authors || '',
            year: node.year || '',
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
            createdAt: now,
            updatedAt: now
        };
        const tx = db.transaction(['graphNodes', 'graphs'], 'readwrite');
        const req = tx.objectStore('graphNodes').add(record);
        req.onsuccess = () => {
            touchGraphUpdatedAtTx(tx, record.graphId);
            resolve(record);
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
    });
}

export function updateGraphNode(node) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['graphNodes', 'graphs'], 'readwrite');
        const next = { ...node, updatedAt: new Date().toISOString() };
        const req = tx.objectStore('graphNodes').put(next);
        req.onsuccess = () => {
            touchGraphUpdatedAtTx(tx, next.graphId);
            resolve(next);
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
    });
}

export async function deleteGraphNode(nodeId) {
    const node = await getGraphNode(nodeId);
    if (!node) return;
    const edges = await getGraphEdges(node.graphId);
    const relatedEdges = edges.filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['graphNodes', 'graphEdges', 'graphs'], 'readwrite');
        tx.objectStore('graphNodes').delete(nodeId);
        relatedEdges.forEach((edge) => tx.objectStore('graphEdges').delete(edge.id));
        touchGraphUpdatedAtTx(tx, node.graphId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export function getGraphEdges(graphId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphEdges', 'readonly');
        const store = tx.objectStore('graphEdges');
        const index = store.index('graphId');
        const req = index.getAll(graphId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function getGraphEdge(edgeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphEdges', 'readonly');
        const store = tx.objectStore('graphEdges');
        const req = store.get(edgeId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getGraphEdgeByPair(graphId, sourceNodeId, targetNodeId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('graphEdges', 'readonly');
        const store = tx.objectStore('graphEdges');
        const index = store.index('graphId_source_target');
        const req = index.get([graphId, sourceNodeId, targetNodeId]);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function addGraphEdge(edge) {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        const record = {
            id: edge.id || generateId(),
            graphId: edge.graphId,
            sourceNodeId: edge.sourceNodeId,
            targetNodeId: edge.targetNodeId,
            sourceAnchor: Number.isInteger(edge.sourceAnchor) ? edge.sourceAnchor : 1,
            targetAnchor: Number.isInteger(edge.targetAnchor) ? edge.targetAnchor : 3,
            controlPoints: Array.isArray(edge.controlPoints) ? edge.controlPoints : [],
            manualRouting: !!edge.manualRouting,
            label: edge.label || '',
            details: edge.details || '',
            createdAt: now,
            updatedAt: now
        };
        const tx = db.transaction(['graphEdges', 'graphs'], 'readwrite');
        const req = tx.objectStore('graphEdges').add(record);
        req.onsuccess = () => {
            touchGraphUpdatedAtTx(tx, record.graphId);
            resolve(record);
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
    });
}

export function updateGraphEdge(edge) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(['graphEdges', 'graphs'], 'readwrite');
        const next = {
            ...edge,
            sourceAnchor: Number.isInteger(edge.sourceAnchor) ? edge.sourceAnchor : 1,
            targetAnchor: Number.isInteger(edge.targetAnchor) ? edge.targetAnchor : 3,
            controlPoints: Array.isArray(edge.controlPoints) ? edge.controlPoints : [],
            manualRouting: !!edge.manualRouting,
            updatedAt: new Date().toISOString()
        };
        const req = tx.objectStore('graphEdges').put(next);
        req.onsuccess = () => {
            touchGraphUpdatedAtTx(tx, next.graphId);
            resolve(next);
        };
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
    });
}

export async function deleteGraphEdge(edgeId) {
    const edge = await getGraphEdge(edgeId);
    if (!edge) return;

    return new Promise((resolve, reject) => {
        const tx = db.transaction(['graphEdges', 'graphs'], 'readwrite');
        tx.objectStore('graphEdges').delete(edgeId);
        touchGraphUpdatedAtTx(tx, edge.graphId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function touchGraphUpdatedAtTx(tx, graphId) {
    const graphStore = tx.objectStore('graphs');
    const req = graphStore.get(graphId);
    req.onsuccess = () => {
        const record = req.result;
        if (!record) return;
        record.updatedAt = new Date().toISOString();
        graphStore.put(record);
    };
}

const MEDIA_SCHEME = 'scholarmark-media://';

export function addMediaAsset(asset) {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        const record = {
            id: asset.id || generateId(),
            pdfId: asset.pdfId || '',
            mimeType: asset.mimeType || 'application/octet-stream',
            blob: asset.blob || null,
            byteSize: Number(asset.byteSize) || Number(asset.blob?.size) || 0,
            width: Number(asset.width) || 0,
            height: Number(asset.height) || 0,
            createdAt: now,
            updatedAt: now
        };
        const tx = db.transaction('mediaAssets', 'readwrite');
        const store = tx.objectStore('mediaAssets');
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error);
    });
}

export function getMediaAsset(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('mediaAssets', 'readonly');
        const store = tx.objectStore('mediaAssets');
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export function getMediaAssetsByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('mediaAssets', 'readonly');
        const store = tx.objectStore('mediaAssets');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function deleteMediaAsset(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('mediaAssets', 'readwrite');
        const store = tx.objectStore('mediaAssets');
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export function getMediaLinksByPdf(pdfId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('mediaLinks', 'readonly');
        const store = tx.objectStore('mediaLinks');
        const index = store.index('pdfId');
        const req = index.getAll(pdfId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export function getMediaLinksByDocument({ pdfId, docType, docId }) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('mediaLinks', 'readonly');
        const store = tx.objectStore('mediaLinks');
        const index = store.index('pdf_doc');
        const req = index.getAll([pdfId, docType, docId]);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

export async function syncMediaLinksForDocument({ pdfId, docType, docId, markdown }) {
    if (!pdfId || !docType || !docId) return;
    const targetAssetIds = new Set(extractMediaAssetIds(markdown));
    const existingLinks = await getMediaLinksByDocument({ pdfId, docType, docId });
    const existingAssetIds = new Set(existingLinks.map((x) => x.assetId));
    const toAdd = [];
    const toDelete = [];

    targetAssetIds.forEach((assetId) => {
        if (!existingAssetIds.has(assetId)) {
            toAdd.push(assetId);
        }
    });
    existingLinks.forEach((link) => {
        if (!targetAssetIds.has(link.assetId)) {
            toDelete.push(link);
        }
    });

    if (toAdd.length || toDelete.length) {
        await new Promise((resolve, reject) => {
            const tx = db.transaction('mediaLinks', 'readwrite');
            const store = tx.objectStore('mediaLinks');
            const now = new Date().toISOString();
            toAdd.forEach((assetId) => {
                store.put({
                    id: generateId(),
                    assetId,
                    pdfId,
                    docType,
                    docId,
                    createdAt: now,
                    updatedAt: now
                });
            });
            toDelete.forEach((link) => {
                store.delete(link.id);
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    const removedAssetIds = Array.from(new Set(toDelete.map((x) => x.assetId)));
    for (const assetId of removedAssetIds) {
        await gcMediaAssetIfUnreferenced(assetId);
    }
}

export async function deleteMediaLinksForDocument({ pdfId, docType, docId }) {
    if (!pdfId || !docType || !docId) return;
    const links = await getMediaLinksByDocument({ pdfId, docType, docId });
    if (!links.length) return;

    await new Promise((resolve, reject) => {
        const tx = db.transaction('mediaLinks', 'readwrite');
        const store = tx.objectStore('mediaLinks');
        links.forEach((link) => {
            store.delete(link.id);
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });

    const assetIds = Array.from(new Set(links.map((x) => x.assetId)));
    for (const assetId of assetIds) {
        await gcMediaAssetIfUnreferenced(assetId);
    }
}

async function gcMediaAssetIfUnreferenced(assetId) {
    if (!assetId) return;
    const count = await countMediaLinksByAssetId(assetId);
    if (count > 0) return;
    await deleteMediaAsset(assetId);
}

function countMediaLinksByAssetId(assetId) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('mediaLinks', 'readonly');
        const store = tx.objectStore('mediaLinks');
        const index = store.index('assetId');
        const req = index.count(assetId);
        req.onsuccess = () => resolve(Number(req.result) || 0);
        req.onerror = () => reject(req.error);
    });
}

function extractMediaAssetIds(markdown) {
    const text = String(markdown || '');
    const escapedScheme = MEDIA_SCHEME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escapedScheme}([a-zA-Z0-9_-]+)`, 'g');
    const ids = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        const id = String(match[1] || '').trim();
        if (id) ids.push(id);
    }
    return ids;
}

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

