function ensureTextareaId(textarea) {
    if (!textarea.id) {
        textarea.id = `md-editor-${Math.random().toString(36).slice(2, 10)}`;
    }
    return textarea.id;
}

function setValueAndNotify(textarea, nextValue, selectionStart, selectionEnd) {
    const prevScrollTop = textarea.scrollTop;
    const prevScrollLeft = textarea.scrollLeft;

    textarea.value = nextValue;
    textarea.focus();
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
        textarea.setSelectionRange(selectionStart, selectionEnd);
    }

    textarea.scrollTop = prevScrollTop;
    textarea.scrollLeft = prevScrollLeft;
    requestAnimationFrame(() => {
        textarea.scrollTop = prevScrollTop;
        textarea.scrollLeft = prevScrollLeft;
    });

    textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapSelection(textarea, prefix, suffix = prefix, placeholder = '') {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = textarea.value.slice(start, end);
    const body = selected || placeholder;
    const next = `${textarea.value.slice(0, start)}${prefix}${body}${suffix}${textarea.value.slice(end)}`;
    const cursorStart = start + prefix.length;
    const cursorEnd = cursorStart + body.length;
    setValueAndNotify(textarea, next, cursorStart, cursorEnd);
}

function applyHeading(textarea, level) {
    const prefix = `${'#'.repeat(level)} `;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const value = textarea.value;
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    const blockEndRaw = value.indexOf('\n', end);
    const blockEnd = blockEndRaw >= 0 ? blockEndRaw : value.length;
    const block = value.slice(blockStart, blockEnd);

    const lines = block.split('\n').map((line) => {
        const noHeading = line.replace(/^#{1,6}\s+/, '');
        return `${prefix}${noHeading}`;
    });
    const replaced = lines.join('\n');
    const next = `${value.slice(0, blockStart)}${replaced}${value.slice(blockEnd)}`;
    setValueAndNotify(textarea, next, blockStart, blockStart + replaced.length);
}

function applyLinePrefix(textarea, prefix) {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const value = textarea.value;
    const blockStart = value.lastIndexOf('\n', start - 1) + 1;
    const blockEndRaw = value.indexOf('\n', end);
    const blockEnd = blockEndRaw >= 0 ? blockEndRaw : value.length;
    const block = value.slice(blockStart, blockEnd);

    const lines = block.split('\n').map((line, idx) => {
        if (!line.trim()) return line;
        if (prefix === '1. ') return `${idx + 1}. ${line.replace(/^\d+\.\s+/, '')}`;
        return `${prefix}${line.replace(/^[-*+]\s+|^>\s+/, '')}`;
    });
    const replaced = lines.join('\n');
    const next = `${value.slice(0, blockStart)}${replaced}${value.slice(blockEnd)}`;
    setValueAndNotify(textarea, next, blockStart, blockStart + replaced.length);
}

function insertCodeBlock(textarea) {
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selected = textarea.value.slice(start, end) || 'code';
    const snippet = `\n\`\`\`\n${selected}\n\`\`\`\n`;
    const next = `${textarea.value.slice(0, start)}${snippet}${textarea.value.slice(end)}`;
    const cursorStart = start + 5;
    const cursorEnd = cursorStart + selected.length;
    setValueAndNotify(textarea, next, cursorStart, cursorEnd);
}

function requestImageFiles(textarea) {
    if (!textarea) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        if (files.length) {
            textarea.dispatchEvent(new CustomEvent('md-toolbar-image-files', {
                bubbles: true,
                detail: { files }
            }));
        }
        input.remove();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
}

function applyAction(textarea, action) {
    if (!textarea || textarea.readOnly) return;
    switch (action) {
        case 'bold':
            wrapSelection(textarea, '**', '**', 'bold text');
            break;
        case 'italic':
            wrapSelection(textarea, '*', '*', 'italic text');
            break;
        case 'h1':
            applyHeading(textarea, 1);
            break;
        case 'h2':
            applyHeading(textarea, 2);
            break;
        case 'h3':
            applyHeading(textarea, 3);
            break;
        case 'ul':
            applyLinePrefix(textarea, '- ');
            break;
        case 'ol':
            applyLinePrefix(textarea, '1. ');
            break;
        case 'quote':
            applyLinePrefix(textarea, '> ');
            break;
        case 'inline-code':
            wrapSelection(textarea, '`', '`', 'code');
            break;
        case 'code-block':
            insertCodeBlock(textarea);
            break;
        case 'link':
            wrapSelection(textarea, '[', '](https://)', 'link text');
            break;
        case 'image':
            requestImageFiles(textarea);
            break;
        default:
            break;
    }
}

function createToolbar(textarea) {
    const wrapper = document.createElement('div');
    wrapper.className = 'md-toolbar';
    wrapper.dataset.for = ensureTextareaId(textarea);
    const supportsImage = ['note-editor', 'summary-editor', 'translation-fulltext-editor'].includes(textarea.id);

    const actions = [
        { key: 'bold', label: 'B', title: 'Bold', group: 'text' },
        { key: 'italic', label: 'I', title: 'Italic', group: 'text' },
        { key: 'h1', label: 'H1', title: 'Heading 1', group: 'heading' },
        { key: 'h2', label: 'H2', title: 'Heading 2', group: 'heading' },
        { key: 'h3', label: 'H3', title: 'Heading 3', group: 'heading' },
        { key: 'ul', label: '•', title: 'Bulleted list', group: 'list' },
        { key: 'ol', label: '1.', title: 'Numbered list', group: 'list' },
        { key: 'quote', label: '"', title: 'Quote', group: 'list' },
        { key: 'inline-code', label: '</>', title: 'Inline code', group: 'code' },
        { key: 'code-block', label: '{}', title: 'Code block', group: 'code' },
        { key: 'link', label: '🔗', title: 'Link', group: 'other' }
    ];
    if (supportsImage) {
        actions.push({ key: 'image', label: '🖼', title: 'Insert image', group: 'other' });
    }

    let lastGroup = '';
    for (const item of actions) {
        if (lastGroup && lastGroup !== item.group) {
            const sep = document.createElement('span');
            sep.className = 'md-toolbar-sep';
            wrapper.appendChild(sep);
        }
        lastGroup = item.group;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-toolbar-btn';
        btn.textContent = item.label;
        btn.title = item.title;
        btn.setAttribute('aria-label', item.title);
        btn.dataset.mdAction = item.key;
        btn.addEventListener('click', () => {
            applyAction(textarea, item.key);
        });
        wrapper.appendChild(btn);
    }

    return wrapper;
}

function bindWheelToHorizontalScroll(toolbar) {
    if (!toolbar || toolbar.dataset.mdWheelBound === '1') return;
    toolbar.addEventListener('wheel', (e) => {
        const mostlyVertical = Math.abs(e.deltaY) >= Math.abs(e.deltaX);
        if (!mostlyVertical) return;
        if (toolbar.scrollWidth <= toolbar.clientWidth) return;
        toolbar.scrollLeft += e.deltaY;
        e.preventDefault();
    }, { passive: false });
    toolbar.dataset.mdWheelBound = '1';
}

export function attachMarkdownToolbar(textarea) {
    if (!textarea || textarea.dataset.mdToolbarBound === '1') return;
    const toolbar = createToolbar(textarea);
    textarea.parentElement?.insertBefore(toolbar, textarea);
    bindWheelToHorizontalScroll(toolbar);
    textarea.dataset.mdToolbarBound = '1';
}

export function initMarkdownToolbars(selectors = []) {
    selectors.forEach((selector) => {
        const textarea = document.querySelector(selector);
        if (textarea) attachMarkdownToolbar(textarea);
    });
}
