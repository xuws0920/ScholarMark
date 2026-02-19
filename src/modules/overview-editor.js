import { $, debounce } from '../utils/dom.js';
import { markSaved, markSaveError } from '../utils/save-status.js';
import * as storage from './storage.js';
import { getCurrentPage, getTotalPages, startFigureClipCapture, cancelFigureClipCapture } from './pdf-viewer.js';

let currentPdfId = null;
let clips = [];
let selectedClipId = null;
let onJumpToPage = null;
let captureActive = false;

const READING_PROGRESS_PREFIX = 'readingProgress:';

export function initOverviewEditor(callbacks = {}) {
  onJumpToPage = callbacks.onJumpToPage || null;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (captureActive) {
      cancelFigureClipCapture();
      resetCaptureUi();
      return;
    }
    if (selectedClipId) {
      closeClipEditor();
    }
  });

  document.querySelectorAll('#overview-tab-bar [data-overview-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#overview-tab-bar [data-overview-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('#workspace-overview .summary-tab-panel').forEach((p) => p.classList.remove('active'));
      $(`#overview-tab-${btn.dataset.overviewTab}`)?.classList.add('active');
    });
  });

  $('#btn-capture-figure')?.addEventListener('click', async () => {
    if (!currentPdfId) {
      alert('请先打开 PDF 文献');
      return;
    }

    const btn = $('#btn-capture-figure');
    if (!captureActive) {
      const ok = startFigureClipCapture({
        onCaptured: async (payload) => {
          await createClipFromCapture(payload);
        },
        onCancel: () => {
          resetCaptureUi();
        },
      });

      if (!ok) {
        alert('当前无法进入框选摘录模式');
        return;
      }

      captureActive = true;
      if (btn) {
        btn.textContent = '按 ESC 取消';
        btn.classList.add('active');
      }
      return;
    }

    cancelFigureClipCapture();
    resetCaptureUi();
  });

  $('#btn-close-figure-editor')?.addEventListener('click', () => {
    closeClipEditor();
  });

  const saveCurrentClipDebounced = debounce(async () => {
    await saveSelectedClip();
  }, 500);

  $('#figure-clip-title')?.addEventListener('input', saveCurrentClipDebounced);
  $('#figure-clip-tags')?.addEventListener('input', saveCurrentClipDebounced);
  $('#figure-clip-note')?.addEventListener('input', saveCurrentClipDebounced);

  $('#btn-save-figure-clip')?.addEventListener('click', async () => {
    await saveSelectedClip(true);
  });

  $('#btn-delete-figure-clip')?.addEventListener('click', async () => {
    const clip = getSelectedClip();
    if (!clip) return;
    if (!confirm(`确定删除图表摘录“${clip.title}”吗？`)) return;

    await storage.deleteFigureClip(clip.id);
    clips = clips.filter((x) => x.id !== clip.id);
    selectedClipId = null;
    closeClipEditor(false);
    renderClipsList();
    renderSelectedClipEditor();
    await refreshOverview();
  });

  $('#btn-jump-figure-page')?.addEventListener('click', () => {
    const clip = getSelectedClip();
    if (!clip) return;
    jumpToPage(clip.page);
  });
}

export async function setPdfId(pdfId) {
  currentPdfId = pdfId;

  if (!pdfId) {
    clearOverviewView();
    return;
  }

  clips = await storage.getFigureClipsByPdf(pdfId);
  clips.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  selectedClipId = null;

  await refreshOverview();
  renderClipsList();
  renderSelectedClipEditor();
}

export function clearOverviewView() {
  currentPdfId = null;
  clips = [];
  selectedClipId = null;
  cancelFigureClipCapture();
  resetCaptureUi();

  const summary = $('#overview-summary');
  if (summary) summary.innerHTML = '<p class="empty-hint">请先打开 PDF 文献</p>';

  const list = $('#figure-clips-list');
  if (list) list.innerHTML = '<p class="empty-hint">暂无图表摘录</p>';

  closeClipEditor(false);
  renderSelectedClipEditor();
}

export async function refreshOverview() {
  if (!currentPdfId) {
    clearOverviewView();
    return;
  }

  const [annotations, notes, progress] = await Promise.all([
    storage.getAnnotationsByPdf(currentPdfId),
    storage.getNotesByPdf(currentPdfId),
    storage.getSetting(`${READING_PROGRESS_PREFIX}${currentPdfId}`)
  ]);

  const questions = annotations.filter((a) => (a.questionMd || '').trim().length > 0).length;
  const currentPage = getCurrentPage() || 1;
  const totalPages = getTotalPages() || 0;
  const lastRead = progress?.updatedAt ? formatDateTime(progress.updatedAt) : '暂无';
  const pageCounter = countByPage(annotations);
  const hotspots = Object.entries(pageCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const summary = $('#overview-summary');
  if (!summary) return;

  summary.innerHTML = `
    <div class="overview-summary-grid">
      <div class="overview-card">
        <div class="overview-card-title">标注总数</div>
        <div class="overview-card-value">${annotations.length}</div>
      </div>
      <div class="overview-card">
        <div class="overview-card-title">含问题标注</div>
        <div class="overview-card-value">${questions}</div>
      </div>
      <div class="overview-card">
        <div class="overview-card-title">图表摘录</div>
        <div class="overview-card-value">${clips.length}</div>
      </div>
      <div class="overview-card">
        <div class="overview-card-title">笔记数</div>
        <div class="overview-card-value">${notes.length}</div>
      </div>
      <div class="overview-card">
        <div class="overview-card-title">当前阅读进度</div>
        <div class="overview-card-value">${totalPages ? `${currentPage}/${totalPages}` : `${currentPage}`}</div>
      </div>
      <div class="overview-card">
        <div class="overview-card-title">最近阅读</div>
        <div class="overview-card-value" style="font-size:14px;font-weight:600;">${lastRead}</div>
      </div>
    </div>
    <div class="overview-sections">
      <div class="overview-card">
        <div class="overview-card-title">热点页（按标注数）</div>
        <div id="overview-hotspots"></div>
      </div>
      <div class="overview-card">
        <div class="overview-card-title">最近问题</div>
        <div id="overview-recent-questions"></div>
      </div>
    </div>
  `;

  const hotspotWrap = $('#overview-hotspots');
  if (hotspotWrap) {
    if (hotspots.length === 0) {
      hotspotWrap.innerHTML = '<p class="empty-hint">暂无数据</p>';
    } else {
      hotspotWrap.innerHTML = hotspots
        .map(([page, count]) => `<button class="overview-list-btn" data-page="${page}">第 ${page} 页 · ${count} 条标注</button>`)
        .join('');
      hotspotWrap.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => jumpToPage(parseInt(btn.dataset.page, 10)));
      });
    }
  }

  const recentQWrap = $('#overview-recent-questions');
  if (recentQWrap) {
    const recent = annotations
      .filter((a) => (a.questionMd || '').trim().length > 0)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 8);

    if (recent.length === 0) {
      recentQWrap.innerHTML = '<p class="empty-hint">暂无问题</p>';
    } else {
      recentQWrap.innerHTML = recent
        .map((a) => `<button class="overview-list-btn" data-page="${a.page}" title="${escapeHtml(a.questionMd || '')}">P${a.page} · ${escapeHtml(shorten(a.questionMd || '', 42))}</button>`)
        .join('');
      recentQWrap.querySelectorAll('[data-page]').forEach((btn) => {
        btn.addEventListener('click', () => jumpToPage(parseInt(btn.dataset.page, 10)));
      });
    }
  }
}

async function createClipFromCapture(payload) {
  if (!currentPdfId) return;

  const indexOnPage = clips.filter((x) => x.page === payload.page).length + 1;
  const record = await storage.addFigureClip({
    pdfId: currentPdfId,
    page: payload.page,
    rect: payload.rect,
    imageDataUrl: payload.imageDataUrl,
    title: `P${payload.page} 图表摘录 ${indexOnPage}`,
    noteMd: '',
    tags: [],
    linkedAnnotationIds: []
  });

  clips.unshift(record);
  selectedClipId = record.id;
  resetCaptureUi();

  renderClipsList();
  renderSelectedClipEditor();
  openClipEditor();
  await refreshOverview();
}

function renderClipsList() {
  const el = $('#figure-clips-list');
  if (!el) return;

  if (!clips.length) {
    el.innerHTML = '<p class="empty-hint">暂无图表摘录</p>';
    return;
  }

  el.innerHTML = clips
    .map((clip) => `
      <div class="figure-clip-item ${clip.id === selectedClipId ? 'active' : ''}" data-clip-id="${clip.id}">
        <img class="figure-clip-thumb" src="${clip.imageDataUrl}" alt="${escapeHtml(clip.title || '')}">
        <div class="figure-clip-item-title">${escapeHtml(clip.title || '图表摘录')}</div>
        <div class="figure-clip-item-meta">第 ${clip.page} 页 · ${formatDateTime(clip.updatedAt)}</div>
      </div>
    `)
    .join('');

  el.querySelectorAll('.figure-clip-item').forEach((item) => {
    item.addEventListener('click', () => {
      selectedClipId = item.dataset.clipId;
      renderClipsList();
      renderSelectedClipEditor();
      openClipEditor();
    });
  });
}

function renderSelectedClipEditor() {
  const clip = getSelectedClip();
  const titleEl = $('#figure-clip-title');
  const tagsEl = $('#figure-clip-tags');
  const noteEl = $('#figure-clip-note');
  const imageWrap = $('#figure-clip-image-wrap');

  const controls = [
    titleEl,
    tagsEl,
    noteEl,
    $('#btn-save-figure-clip'),
    $('#btn-delete-figure-clip'),
    $('#btn-jump-figure-page')
  ];

  controls.forEach((node) => {
    if (node) node.disabled = !clip;
  });

  if (!clip) {
    if (titleEl) titleEl.value = '';
    if (tagsEl) tagsEl.value = '';
    if (noteEl) noteEl.value = '';
    if (imageWrap) imageWrap.innerHTML = '<p class="empty-hint">请选择图表项</p>';
    return;
  }

  if (titleEl) titleEl.value = clip.title || '';
  if (tagsEl) tagsEl.value = Array.isArray(clip.tags) ? clip.tags.join(', ') : '';
  if (noteEl) noteEl.value = clip.noteMd || '';
  if (imageWrap) imageWrap.innerHTML = `<img src="${clip.imageDataUrl}" alt="${escapeHtml(clip.title || '')}">`;
}

async function saveSelectedClip(showHint = false) {
  const clip = getSelectedClip();
  if (!clip) return;

  const title = ($('#figure-clip-title')?.value || '').trim();
  const tagsRaw = ($('#figure-clip-tags')?.value || '').trim();
  const noteMd = $('#figure-clip-note')?.value || '';

  clip.title = title || `P${clip.page} 图表摘录`;
  clip.tags = tagsRaw ? tagsRaw.split(',').map((x) => x.trim()).filter(Boolean) : [];
  clip.noteMd = noteMd;

  try {
    const updated = await storage.updateFigureClip(clip);
    const idx = clips.findIndex((x) => x.id === updated.id);
    if (idx >= 0) clips[idx] = updated;

    renderClipsList();
    await refreshOverview();
    markSaved('图表摘录', '已保存');
  } catch (err) {
    console.warn(err);
    markSaveError('图表摘录', '保存失败');
  }

  if (showHint) {
    alert('图表摘录已保存');
  }
}

function getSelectedClip() {
  if (!selectedClipId) return null;
  return clips.find((x) => x.id === selectedClipId) || null;
}

function openClipEditor() {
  const drawer = $('#figure-clip-editor-drawer');
  if (!drawer) return;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeClipEditor(clearSelection = true) {
  const drawer = $('#figure-clip-editor-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');

  if (clearSelection) {
    selectedClipId = null;
    renderClipsList();
    renderSelectedClipEditor();
  }
}

function jumpToPage(page) {
  if (!Number.isInteger(page) || page <= 0) return;
  onJumpToPage?.(page);
}

function resetCaptureUi() {
  captureActive = false;
  const btn = $('#btn-capture-figure');
  if (btn) {
    btn.textContent = '框选摘录';
    btn.classList.remove('active');
  }
}

function countByPage(annotations) {
  const counter = {};
  annotations.forEach((a) => {
    const p = a.page || 0;
    if (!counter[p]) counter[p] = 0;
    counter[p] += 1;
  });
  return counter;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function shorten(text, max) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1)}…`;
}

function formatDateTime(isoString) {
  if (!isoString) return '暂无';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '暂无';
  return d.toLocaleString();
}

