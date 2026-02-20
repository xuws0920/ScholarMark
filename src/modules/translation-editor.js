import { $, debounce } from '../utils/dom.js';
import { renderMarkdown } from '../utils/markdown.js';
import { capturePageImage, cancelFigureClipCapture, getCurrentPage, getTotalPages, startFigureClipCapture } from './pdf-viewer.js';
import * as storage from './storage.js';
import { sha256Text } from '../utils/hash.js';
import { parseFieldMapping, translateImageWithOpenAICompatible } from '../utils/llm-client.js';
import { markSaved, markSaveError } from '../utils/save-status.js';

const SETTINGS_KEY = 'aiTranslation';
const PROMPT_VERSION = 'v2-cn-only';
const TERMINOLOGY_VERSION = 'v2-cn-only';
const FULLTEXT_DOC_KEY_PREFIX = 'translationFulltextDoc:';

const DEFAULT_SYSTEM_PROMPT = [
  '你是专业学术论文翻译助手。',
  '请仅输出中文翻译结果，不要输出原文，不要输出双语对照，不要输出额外分节。',
  '要求：术语准确、表达清晰、保持原文逻辑。',
  '公式尽量保留原样，不确定字符用 [uncertain] 标记。'
].join('\n');

const DEFAULT_FIELD_MAPPING = JSON.stringify({
  endpoint: '/chat/completions',
  responseTextPath: 'choices[0].message.content',
  usagePath: 'usage'
}, null, 2);

let currentPdfId = null;
let settings = null;
let captureActive = false;
let fulltextItems = [];
let currentWorkbench = null;
let onInsertToSummary = null;
let fulltextOutlineItems = [];
let activeFulltextOutlineId = null;

const FULLTEXT_OUTLINE_DRAWER_OPEN_KEY = 'translation-fulltext-outline-drawer-open';
let translationOutlineHeightRaf = 0;
const saveFulltextDocDebounced = debounce(async () => {
  await persistFulltextDocument();
}, 300);

export function initTranslationEditor(callbacks = {}) {
  onInsertToSummary = callbacks.onInsertToSummary || null;
  bindTranslationTabs();
  bindFulltextTabs();
  bindActions();
  bindFulltextEditor();
  bindFulltextOutline();
  restoreFulltextOutlineDrawerState();
  window.addEventListener('resize', scheduleFulltextOutlineHeightUpdate);
  bindSettingsFields();
  void loadSettingsToUi();
}

export async function setPdfId(pdfId) {
  currentPdfId = pdfId;
  resetCaptureUi();
  currentWorkbench = null;
  renderWorkbench();

  if (!pdfId) {
    clearTranslationView();
    return;
  }

  await reloadFulltextTranslations();
  await loadFulltextDocument();
  const total = getTotalPages();
  const startInput = $('#translation-range-start');
  const endInput = $('#translation-range-end');
  if (startInput) {
    startInput.min = '1';
    startInput.max = String(Math.max(1, total));
    startInput.value = '1';
  }
  if (endInput) {
    endInput.min = '1';
    endInput.max = String(Math.max(1, total));
    endInput.value = String(Math.max(1, total));
  }
}

export function clearTranslationView() {
  currentPdfId = null;
  currentWorkbench = null;
  fulltextItems = [];
  fulltextOutlineItems = [];
  activeFulltextOutlineId = null;
  cancelFigureClipCapture();
  renderWorkbench();
  renderFulltext('');
  renderFulltextOutline();
  setStatus('请先打开 PDF 文献');
}

export function getCurrentTranslationMarkdown() {
  const tab = getActiveTranslationTab();
  if (tab === 'fulltext') {
    return $('#translation-fulltext-editor')?.value || '';
  }
  return currentWorkbench?.text || '';
}

export function getFulltextTranslationMarkdown() {
  return $('#translation-fulltext-editor')?.value || '';
}

async function reloadFulltextTranslations() {
  if (!currentPdfId) return;
  const all = await storage.getTranslationsByPdf(currentPdfId);
  fulltextItems = all
    .filter((x) => x.sourceType === 'page_full' || x.archivedToFulltext)
    .sort((a, b) => a.page - b.page || new Date(a.updatedAt) - new Date(b.updatedAt));
}

function bindTranslationTabs() {
  const btns = document.querySelectorAll('#translation-tab-bar [data-translation-tab]');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.translationTab;
      document.querySelectorAll('#workspace-translation .summary-tab-panel').forEach((panel) => panel.classList.remove('active'));
      $(`#translation-tab-${tab}`)?.classList.add('active');
    });
  });
}

function bindFulltextTabs() {
  const btns = document.querySelectorAll('#translation-fulltext-inner-tabs [data-fulltext-tab]');
  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      btns.forEach((x) => x.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.fulltextTab;
      $('#translation-fulltext-editor-panel')?.classList.toggle('active', tab === 'editor');
      $('#translation-fulltext-preview-panel')?.classList.toggle('active', tab === 'preview');
      if (tab === 'preview') {
        renderFulltextPreview();
      }
    });
  });
}

function bindFulltextEditor() {
  const editor = $('#translation-fulltext-editor');
  if (!editor) return;
  editor.addEventListener('input', debounce(() => {
    refreshFulltextOutline(editor.value || '');
    renderFulltextPreview();
  }, 120));
  editor.addEventListener('input', () => {
    saveFulltextDocDebounced();
  });
}

function bindFulltextOutline() {
  $('#btn-open-translation-outline')?.addEventListener('click', () => {
    toggleFulltextOutlineDrawer();
  });

  $('#translation-fulltext-outline-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.notes-outline-item');
    if (!btn) return;
    const outlineId = btn.dataset.outlineId;
    const item = fulltextOutlineItems.find((x) => x.outlineId === outlineId);
    if (!item) return;
    jumpToFulltextOutline(item);
  });

  $('#btn-toggle-translation-outline')?.addEventListener('click', () => {
    closeFulltextOutlineDrawer();
  });
}

function bindActions() {
  $('#btn-capture-translate')?.addEventListener('click', async () => {
    if (!currentPdfId) {
      alert('请先打开 PDF 文献');
      return;
    }
    if (!captureActive) {
      const ok = startFigureClipCapture({
        onCaptured: async (payload) => {
          try {
            await handleImageTranslation({
              page: payload.page,
              imageDataUrl: payload.imageDataUrl,
              sourceType: 'image_clip',
              persistFulltext: false
            });
          } catch (err) {
            console.error(err);
          }
        },
        onCancel: () => {
          resetCaptureUi();
        }
      });
      if (!ok) {
        alert('当前无法进入框选翻译模式，请先关闭其他框选操作');
        return;
      }
      captureActive = true;
      const btn = $('#btn-capture-translate');
      if (btn) {
        btn.classList.add('active');
        btn.textContent = '按 ESC 取消';
      }
      setStatus('已进入框选翻译模式，拖拽选中区域后自动翻译');
      return;
    }

    cancelFigureClipCapture();
    resetCaptureUi();
  });

  $('#btn-copy-current-translation')?.addEventListener('click', async () => {
    const text = currentWorkbench?.text || '';
    if (!text.trim()) {
      alert('当前没有可复制的翻译结果');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已复制当前译文');
    } catch (err) {
      console.warn(err);
      setStatus('复制失败，请手动复制');
    }
  });

  $('#btn-retry-current-translation')?.addEventListener('click', async () => {
    if (!currentWorkbench?.imageDataUrl) {
      alert('当前没有可重译的截图');
      return;
    }
    await handleImageTranslation({
      page: currentWorkbench.page,
      imageDataUrl: currentWorkbench.imageDataUrl,
      sourceType: 'image_clip',
      persistFulltext: false,
      forceRefresh: true
    });
  });

  $('#btn-translate-current-page')?.addEventListener('click', async () => {
    if (!currentPdfId) {
      alert('请先打开 PDF 文献');
      return;
    }
    const page = getCurrentPage() || 1;
    const imageDataUrl = capturePageImage(page);
    if (!imageDataUrl) {
      alert('当前页截图失败，请稍后重试');
      return;
    }
    await handleImageTranslation({
      page,
      imageDataUrl,
      sourceType: 'page_full',
      persistFulltext: true
    });
  });

  $('#btn-translate-range')?.addEventListener('click', async () => {
    if (!currentPdfId) {
      alert('请先打开 PDF 文献');
      return;
    }

    const total = Math.max(1, getTotalPages());
    let start = parseInt($('#translation-range-start')?.value || '1', 10);
    let end = parseInt($('#translation-range-end')?.value || String(total), 10);
    if (!Number.isFinite(start)) start = 1;
    if (!Number.isFinite(end)) end = total;
    start = Math.min(total, Math.max(1, start));
    end = Math.min(total, Math.max(1, end));
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }

    const job = await storage.upsertTranslationJob({
      pdfId: currentPdfId,
      mode: 'fulltext_range',
      rangeStart: start,
      rangeEnd: end,
      status: 'running',
      progress: { done: 0, total: end - start + 1, failedPages: [] }
    });

    const failedPages = [];
    for (let page = start; page <= end; page++) {
      const done = page - start;
      setStatus(`全文翻译进行中：${done}/${end - start + 1}，当前第 ${page} 页`);
      const imageDataUrl = capturePageImage(page);
      if (!imageDataUrl) {
        failedPages.push(page);
        continue;
      }
      try {
        await handleImageTranslation({
          page,
          imageDataUrl,
          sourceType: 'page_full',
          persistFulltext: true,
          silent: true
        });
      } catch (err) {
        console.error(err);
        failedPages.push(page);
      }
      await storage.upsertTranslationJob({
        ...job,
        status: 'running',
        progress: {
          done: done + 1,
          total: end - start + 1,
          failedPages
        }
      });
    }

    await storage.upsertTranslationJob({
      ...job,
      status: failedPages.length ? 'partial_failed' : 'completed',
      progress: {
        done: end - start + 1,
        total: end - start + 1,
        failedPages
      },
      error: failedPages.length ? `失败页: ${failedPages.join(', ')}` : ''
    });

    setStatus(
      failedPages.length
        ? `全文翻译完成，失败页：${failedPages.join(', ')}`
        : '全文翻译完成'
    );
  });

}

function bindSettingsFields() {
  const syncDebounced = debounce(async () => {
    await persistSettingsFromUi();
  }, 350);

  [
    '#ai-base-url',
    '#ai-api-key',
    '#ai-model',
    '#ai-field-mapping',
    '#ai-system-prompt',
    '#ai-terminology',
    '#ai-output-mode'
  ].forEach((selector) => {
    $(selector)?.addEventListener('input', syncDebounced);
    $(selector)?.addEventListener('change', syncDebounced);
  });

  $('#btn-save-ai-settings')?.addEventListener('click', async () => {
    await persistSettingsFromUi(true);
  });
}

async function loadSettingsToUi() {
  settings = await getSettings();
  $('#ai-base-url').value = settings.baseUrl || '';
  $('#ai-api-key').value = settings.apiKey || '';
  $('#ai-model').value = settings.model || '';
  $('#ai-field-mapping').value = settings.fieldMapping || DEFAULT_FIELD_MAPPING;
  $('#ai-system-prompt').value = settings.systemPromptTemplate || DEFAULT_SYSTEM_PROMPT;
  $('#ai-terminology').value = settings.terminologyDictRaw || '';
  $('#ai-output-mode').value = settings.outputMode || 'cn_only';
}

async function persistSettingsFromUi(showAlert = false) {
  const next = {
    providerType: 'openai_compatible',
    baseUrl: ($('#ai-base-url')?.value || '').trim(),
    apiKey: ($('#ai-api-key')?.value || '').trim(),
    model: ($('#ai-model')?.value || '').trim(),
    fieldMapping: ($('#ai-field-mapping')?.value || '').trim() || DEFAULT_FIELD_MAPPING,
    systemPromptTemplate: ($('#ai-system-prompt')?.value || '').trim() || DEFAULT_SYSTEM_PROMPT,
    terminologyDictRaw: ($('#ai-terminology')?.value || '').trim(),
    outputMode: 'cn_only'
  };
  settings = {
    ...next,
    terminologyDict: parseTerminologyDict(next.terminologyDictRaw)
  };
  await storage.setSetting(SETTINGS_KEY, settings);
  markSaved('AI 设置', '已保存');
  if (showAlert) {
    alert('AI 翻译配置已保存');
  }
}

async function handleImageTranslation({
  page,
  imageDataUrl,
  sourceType,
  persistFulltext,
  silent = false,
  forceRefresh = false
}) {
  try {
    const cfg = await ensureSettings();
    const imageHash = await sha256Text(imageDataUrl);
    const cacheId = await sha256Text(`${imageHash}|${cfg.model}|${PROMPT_VERSION}|${TERMINOLOGY_VERSION}`);

    let cached = null;
    if (!forceRefresh) {
      cached = await storage.getTranslationCache(cacheId);
    }

    let translatedText = '';
    let usage = null;
    if (cached?.bilingualMd) {
      translatedText = cached.bilingualMd;
      usage = cached.usage || null;
      if (!silent) setStatus(`命中缓存：第 ${page} 页`);
    } else {
      if (!silent) setStatus(`AI 翻译中：第 ${page} 页`);
      const fieldMapping = parseFieldMapping(cfg.fieldMapping);
      const response = await translateImageWithOpenAICompatible({
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        systemPrompt: cfg.systemPromptTemplate,
        userPrompt: buildUserPrompt(cfg.terminologyDict),
        imageDataUrl,
        fieldMapping
      });
      translatedText = response.text || '';
      usage = response.usage || null;

      await storage.upsertTranslationCache({
        id: cacheId,
        pdfId: currentPdfId,
        page,
        imageHash,
        provider: 'openai_compatible',
        model: cfg.model,
        promptVersion: PROMPT_VERSION,
        terminologyVersion: TERMINOLOGY_VERSION,
        bilingualMd: translatedText,
        formulaNotes: '',
        terminologyWarnings: [],
        usage
      });
    }

    if (sourceType === 'image_clip') {
      currentWorkbench = {
        page,
        imageDataUrl,
        text: translatedText,
        updatedAt: new Date().toISOString()
      };
      renderWorkbench();
      if (!silent) setStatus(`截图翻译完成：第 ${page} 页`);
      return;
    }

    if (persistFulltext) {
      const existing = fulltextItems.find((x) => x.page === page);
      if (existing) {
        await storage.updateTranslation({
          ...existing,
          sourceImageDataUrl: imageDataUrl,
          imageHash,
          bilingualMd: translatedText,
          sourceType: 'page_full',
          archivedToFulltext: true,
          provider: 'openai_compatible',
          model: cfg.model,
          promptVersion: PROMPT_VERSION,
          terminologyVersion: TERMINOLOGY_VERSION,
          formulaNotes: '',
          terminologyWarnings: [],
          usage,
          error: ''
        });
      } else {
        await storage.addTranslation({
          pdfId: currentPdfId,
          page,
          sourceType: 'page_full',
          archivedToFulltext: true,
          imageHash,
          sourceImageDataUrl: imageDataUrl,
          bilingualMd: translatedText,
          formulaNotes: '',
          terminologyWarnings: [],
          provider: 'openai_compatible',
          model: cfg.model,
          promptVersion: PROMPT_VERSION,
          terminologyVersion: TERMINOLOGY_VERSION,
          usage
        });
      }
      await reloadFulltextTranslations();
      await upsertFulltextSectionIfMissing(page, translatedText);
      if (!silent) setStatus(`整页翻译完成：第 ${page} 页`);
    }
  } catch (err) {
    const message = err?.message || '翻译失败';
    setStatus(message);
    if (!silent) alert(message);
    throw err;
  }
}

function renderWorkbench() {
  const output = $('#translation-current-output');
  if (!output) return;
  output.value = currentWorkbench?.text || '';
}

function renderFulltext(content = null) {
  const editor = $('#translation-fulltext-editor');
  if (!editor) return;

  editor.value = content == null ? (editor.value || '') : content;
  refreshFulltextOutline(editor.value);
  renderFulltextPreview();
}

function renderFulltextPreview() {
  const preview = $('#translation-fulltext-preview');
  const editor = $('#translation-fulltext-editor');
  if (!preview || !editor) return;
  const content = editor.value || '';
  preview.innerHTML = renderMarkdown(content) || '<p class="empty-hint">暂无全文翻译结果</p>';
  const headings = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach((node, idx) => {
    const item = fulltextOutlineItems[idx];
    if (item) {
      node.dataset.outlineId = item.outlineId;
      node.title = item.fullText;
    }
  });
  dispatchFulltextPreviewUpdate(content, preview.innerHTML);
}

function refreshFulltextOutline(content) {
  fulltextOutlineItems = parseFulltextOutlineItems(content);
  if (!fulltextOutlineItems.find((x) => x.outlineId === activeFulltextOutlineId)) {
    activeFulltextOutlineId = fulltextOutlineItems[0]?.outlineId || null;
  }
  renderFulltextOutline();
}

function parseFulltextOutlineItems(content) {
  if (!content) return [];
  const items = [];
  const regex = /^(#{1,6})\s+(.+?)\s*$/gm;
  let m;
  let seq = 0;
  while ((m = regex.exec(content)) !== null) {
    const hashes = m[1] || '#';
    const title = (m[2] || '').trim();
    const level = hashes.length;
    const outlineId = `fulltext-h-${seq}`;
    seq += 1;
    items.push({
      outlineId,
      level,
      fullText: title,
      shortText: title.length > 52 ? `${title.slice(0, 51)}…` : title,
      index: m.index
    });
  }
  return items;
}

function renderFulltextOutline() {
  const list = $('#translation-fulltext-outline-list');
  if (!list) return;
  if (!fulltextOutlineItems.length) {
    list.innerHTML = '<p class="empty-hint">暂无标题</p>';
    scheduleFulltextOutlineHeightUpdate();
    return;
  }

  list.innerHTML = '';
  for (const item of fulltextOutlineItems) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notes-outline-item';
    btn.dataset.outlineId = item.outlineId;
    btn.title = item.fullText;
    if (activeFulltextOutlineId === item.outlineId) {
      btn.classList.add('active');
    }
    const indent = Math.max(0, (item.level - 1) * 12);
    btn.style.paddingLeft = `${8 + indent}px`;
    btn.innerHTML = `<span class="notes-outline-item-page">H${item.level}</span>${escapeHtml(item.shortText)}`;
    list.appendChild(btn);
  }
  scheduleFulltextOutlineHeightUpdate();
}

function jumpToFulltextOutline(item) {
  activeFulltextOutlineId = item.outlineId;
  renderFulltextOutline();

  const activeTab = document.querySelector('#translation-fulltext-inner-tabs [data-fulltext-tab].active')?.dataset.fulltextTab || 'editor';
  if (activeTab === 'preview') {
    renderFulltextPreview();
    const target = $('#translation-fulltext-preview')?.querySelector(`[data-outline-id="${item.outlineId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.add('outline-jump-highlight');
      setTimeout(() => target.classList.remove('outline-jump-highlight'), 1200);
    }
    return;
  }

  const editor = $('#translation-fulltext-editor');
  if (!editor) return;
  const start = Math.max(0, Math.min(item.index, editor.value.length));
  jumpInFulltextEditor(editor, start, item.fullText);
}

function jumpInFulltextEditor(editor, start, fullText) {
  const end = Math.min(editor.value.length, start + Math.max((fullText || '').length, 10));
  editor.focus();
  editor.setSelectionRange(start, end);

  // First choice: mirror-based pixel measurement, resilient to line wrapping.
  const measuredTop = measureCaretTopInTextarea(editor, start);

  // Fallback: estimate by newline count and proportional position.
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 24;
  const lineNumber = 1 + countNewLines(editor.value, start);
  const byLineTop = Math.max(0, (lineNumber - 1) * lineHeight - editor.clientHeight * 0.35);
  const ratio = start / Math.max(editor.value.length, 1);
  const byRatioTop = Math.max(0, (editor.scrollHeight - editor.clientHeight) * ratio - editor.clientHeight * 0.2);
  const fallbackTop = Math.max(byLineTop, byRatioTop);
  const targetTop = Number.isFinite(measuredTop) ? Math.max(0, measuredTop - editor.clientHeight * 0.5) : fallbackTop;

  // Some browsers ignore immediate scroll after setSelectionRange; force in multiple frames.
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

function toggleFulltextOutlineDrawer() {
  const panel = $('#translation-outline-panel');
  const opener = $('#btn-open-translation-outline');
  if (!panel) return;

  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  panel.setAttribute('aria-hidden', opening ? 'false' : 'true');
  if (opener) opener.classList.toggle('active', opening);
  localStorage.setItem(FULLTEXT_OUTLINE_DRAWER_OPEN_KEY, opening ? '1' : '0');

  if (opening) {
    scheduleFulltextOutlineHeightUpdate();
  } else {
    panel.style.height = '';
  }
}

function closeFulltextOutlineDrawer() {
  const panel = $('#translation-outline-panel');
  const opener = $('#btn-open-translation-outline');
  if (!panel) return;
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  panel.style.height = '';
  panel.style.left = '';
  panel.style.top = '';
  if (opener) opener.classList.remove('active');
  localStorage.setItem(FULLTEXT_OUTLINE_DRAWER_OPEN_KEY, '0');
}

function restoreFulltextOutlineDrawerState() {
  const shouldOpen = localStorage.getItem(FULLTEXT_OUTLINE_DRAWER_OPEN_KEY) === '1';
  if (shouldOpen) {
    toggleFulltextOutlineDrawer();
  } else {
    closeFulltextOutlineDrawer();
  }
}

function scheduleFulltextOutlineHeightUpdate() {
  if (translationOutlineHeightRaf) {
    cancelAnimationFrame(translationOutlineHeightRaf);
  }
  translationOutlineHeightRaf = requestAnimationFrame(() => {
    translationOutlineHeightRaf = 0;
    updateFulltextOutlineDrawerHeight();
  });
}

function updateFulltextOutlineDrawerHeight() {
  const drawer = $('#translation-outline-panel');
  if (!drawer || !drawer.classList.contains('open')) return;
  const sidebar = $('#sidebar-right');
  const viewer = $('#pdf-viewer-section');
  const layout = $('#translation-fulltext-layout');
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

function fulltextDocKey(pdfId) {
  return `${FULLTEXT_DOC_KEY_PREFIX}${pdfId}`;
}

function buildFulltextDocumentFromItems(items) {
  if (!Array.isArray(items) || !items.length) return '';
  const lines = ['# 全文翻译', ''];
  for (const item of items) {
    lines.push(`## 第 ${item.page} 页`);
    lines.push('');
    lines.push(item.bilingualMd || '');
    lines.push('');
  }
  return lines.join('\n').trim();
}

async function loadFulltextDocument() {
  if (!currentPdfId) {
    renderFulltext('');
    return;
  }
  const saved = await storage.getSetting(fulltextDocKey(currentPdfId));
  if (typeof saved === 'string') {
    renderFulltext(saved);
    return;
  }
  const generated = buildFulltextDocumentFromItems(fulltextItems);
  renderFulltext(generated);
  if (generated.trim()) {
    await storage.setSetting(fulltextDocKey(currentPdfId), generated);
  }
}

async function persistFulltextDocument() {
  if (!currentPdfId) return;
  const editor = $('#translation-fulltext-editor');
  if (!editor) return;
  try {
    await storage.setSetting(fulltextDocKey(currentPdfId), editor.value || '');
    markSaved('全文翻译', '已保存');
  } catch (err) {
    console.warn(err);
    markSaveError('全文翻译', '保存失败');
  }
}

async function upsertFulltextSectionIfMissing(page, text) {
  const editor = $('#translation-fulltext-editor');
  if (!editor) return;
  const content = editor.value || '';
  const heading = `## 第 ${page} 页`;
  const hasPageSection = new RegExp(`^##\\s*第\\s*${page}\\s*页\\s*$`, 'm').test(content);
  if (hasPageSection) {
    return;
  }

  const sectionLines = [heading, '', text || '', ''];
  let next = content.trim();
  if (!next) {
    next = ['# 全文翻译', '', ...sectionLines].join('\n');
  } else {
    if (!/\n$/.test(next)) next += '\n';
    next = `${next}\n${sectionLines.join('\n')}`.trimEnd();
  }
  renderFulltext(next);
  await persistFulltextDocument();
}

function setStatus(text) {
  const el = $('#translation-workbench-status');
  if (el) el.textContent = text;
}

function resetCaptureUi() {
  captureActive = false;
  const btn = $('#btn-capture-translate');
  if (!btn) return;
  btn.classList.remove('active');
  btn.textContent = '框选翻译';
}

function getActiveTranslationTab() {
  const activeBtn = $('#translation-tab-bar [data-translation-tab].active');
  return activeBtn?.dataset.translationTab || 'workbench';
}

async function getSettings() {
  const saved = await storage.getSetting(SETTINGS_KEY);
  const next = {
    providerType: 'openai_compatible',
    baseUrl: saved?.baseUrl || '',
    apiKey: saved?.apiKey || '',
    model: saved?.model || '',
    fieldMapping: saved?.fieldMapping || DEFAULT_FIELD_MAPPING,
    systemPromptTemplate: saved?.systemPromptTemplate || DEFAULT_SYSTEM_PROMPT,
    terminologyDictRaw: saved?.terminologyDictRaw || '',
    outputMode: 'cn_only'
  };
  return {
    ...next,
    terminologyDict: parseTerminologyDict(next.terminologyDictRaw)
  };
}

async function ensureSettings() {
  if (!settings) {
    settings = await getSettings();
  }
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    throw new Error('请先在设置中填写 Base URL、API Key、Model');
  }
  return settings;
}

function parseTerminologyDict(raw) {
  if (!raw) return {};
  const map = {};
  raw.split('\n').forEach((line) => {
    const text = line.trim();
    if (!text || text.startsWith('#')) return;
    const idx = text.indexOf('=');
    if (idx <= 0) return;
    const key = text.slice(0, idx).trim();
    const val = text.slice(idx + 1).trim();
    if (!key || !val) return;
    map[key] = val;
  });
  return map;
}

function buildUserPrompt(glossary) {
  const entries = Object.entries(glossary || {});
  const glossaryText = entries.length
    ? entries.map(([k, v]) => `- ${k} => ${v}`).join('\n')
    : '- （未提供术语库）';

  return [
    '请将这张论文截图翻译成中文。',
    '仅输出中文译文正文，不要输出原文，不要输出双语对照。',
    '术语优先，尽量遵循以下术语库：',
    glossaryText
  ].join('\n');
}

function formatDateTime(isoString) {
  const d = new Date(isoString || '');
  if (Number.isNaN(d.getTime())) return '未知时间';
  return d.toLocaleString();
}

function countNewLines(text, endIndex) {
  let count = 0;
  const max = Math.min(endIndex, text.length);
  for (let i = 0; i < max; i += 1) {
    if (text[i] === '\n') count += 1;
  }
  return count;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function dispatchFulltextPreviewUpdate(markdown, html) {
  window.dispatchEvent(new CustomEvent('translation:fulltext-preview-updated', {
    detail: {
      markdown: markdown || '',
      html: html || ''
    }
  }));
}
