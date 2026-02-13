/**
 * export.js — 笔记导出功能
 */

/**
 * 使用 File System Access API 选择目录
 */
export async function chooseDirectory() {
    if (!('showDirectoryPicker' in window)) {
        alert('您的浏览器不支持目录选择功能，请使用 Chrome 或 Edge 浏览器。');
        return null;
    }
    try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        return dirHandle;
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('选择目录失败:', e);
        }
        return null;
    }
}

/**
 * 将笔记内容导出为 .md 文件到指定目录
 */
export async function exportNoteToDir(dirHandle, pdfName, noteTitle, content) {
    try {
        // 创建 PDF 名字的子文件夹
        const folderName = sanitizeFileName(pdfName.replace('.pdf', ''));
        const subDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

        // 创建 md 文件
        const fileName = sanitizeFileName(noteTitle) + '.md';
        const fileHandle = await subDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();

        return true;
    } catch (e) {
        console.error('导出笔记失败:', e);
        return false;
    }
}

/**
 * 将笔记下载为 .md 文件（不需要 File System Access API）
 */
export function downloadNote(noteTitle, content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFileName(noteTitle) + '.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 批量导出所有笔记
 */
export async function exportAllNotes(dirHandle, pdfName, notes) {
    let successCount = 0;
    for (const note of notes) {
        const ok = await exportNoteToDir(dirHandle, pdfName, note.title, note.content);
        if (ok) successCount++;
    }
    return successCount;
}

function sanitizeFileName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim() || '未命名';
}
