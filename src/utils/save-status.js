import { $ } from './dom.js';

let hideTimer = null;

function nowTimeText() {
    const d = new Date();
    return d.toLocaleTimeString();
}

export function showSaveStatus(message, type = 'saved') {
    const el = $('#global-save-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = type;
    el.classList.add('visible');

    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        el.classList.remove('visible');
    }, 3500);
}

export function markSaved(scope = '内容', mode = '已保存') {
    showSaveStatus(`${scope}${mode} ${nowTimeText()}`, 'saved');
}

export function markSaveError(scope = '内容', reason = '保存失败') {
    showSaveStatus(`${scope}${reason} ${nowTimeText()}`, 'error');
}
