const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'src', 'styles');

let indexCss = fs.readFileSync(path.join(cssDir, 'index.css'), 'utf-8');

// Global theme updates
const replacements = {
    // Dark mode root
    '--bg-primary: #0f1117;': '--bg-primary: #191919;',
    '--bg-secondary: #161822;': '--bg-secondary: #202020;',
    '--bg-tertiary: #1e2030;': '--bg-tertiary: #2a2a2a;',
    '--bg-elevated: #252839;': '--bg-elevated: #2f2f2f;',
    '--bg-hover: #2a2d42;': '--bg-hover: rgba(255, 255, 255, 0.06);',
    '--bg-active: #32365a;': '--bg-active: rgba(255, 255, 255, 0.1);',

    '--border-subtle: rgba(255, 255, 255, 0.06);': '--border-subtle: rgba(255, 255, 255, 0.08);',
    '--border-default: rgba(255, 255, 255, 0.1);': '--border-default: rgba(255, 255, 255, 0.12);',
    '--border-strong: rgba(255, 255, 255, 0.16);': '--border-strong: rgba(255, 255, 255, 0.2);',

    '--text-primary: #e8eaed;': '--text-primary: rgba(255, 255, 255, 0.9);',
    '--text-secondary: #9aa0b0;': '--text-secondary: rgba(255, 255, 255, 0.65);',
    '--text-tertiary: #636980;': '--text-tertiary: rgba(255, 255, 255, 0.4);',
    '--text-accent: #7c8cf8;': '--text-accent: #60A5FA;',

    '--accent-primary: #7c8cf8;': '--accent-primary: #3B82F6;',
    '--accent-primary-hover: #9ba6fa;': '--accent-primary-hover: #60A5FA;',
    '--accent-primary-bg: rgba(124, 140, 248, 0.12);': '--accent-primary-bg: rgba(59, 130, 246, 0.15);',
    '--accent-danger: #f87171;': '--accent-danger: #EF4444;',
    '--accent-danger-bg: rgba(248, 113, 113, 0.12);': '--accent-danger-bg: rgba(239, 68, 68, 0.12);',
    '--accent-success: #34d399;': '--accent-success: #10B981;',

    '--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);': '--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.2);',
    '--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);': '--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);',
    '--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.5);': '--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.4);',
    '--shadow-glow: 0 0 20px rgba(124, 140, 248, 0.15);': '--shadow-glow: 0 0 20px rgba(59, 130, 246, 0.15);',

    '--radius-sm: 4px;': '--radius-sm: 6px;',

    // Light mode
    '--bg-primary: #f5f6fa;': '--bg-primary: #FFFFFF;',
    '--bg-secondary: #ffffff;': '--bg-secondary: #F7F7F5;',
    '--bg-tertiary: #eef0f5;': '--bg-tertiary: #EFEFEF;',
    '--bg-elevated: #ffffff;': '--bg-elevated: #FFFFFF;',
    '--bg-hover: #e8eaf0;': '--bg-hover: rgba(0, 0, 0, 0.04);',
    '--bg-active: #dde0ea;': '--bg-active: rgba(0, 0, 0, 0.08);',

    '--border-default: rgba(0, 0, 0, 0.12);': '--border-default: rgba(0, 0, 0, 0.08);',
    '--border-strong: rgba(0, 0, 0, 0.2);': '--border-strong: rgba(0, 0, 0, 0.15);',

    '--text-primary: #1a1d2e;': '--text-primary: #37352F;',
    '--text-secondary: #4a5068;': '--text-secondary: rgba(55, 53, 47, 0.65);',
    '--text-tertiary: #8890a4;': '--text-tertiary: rgba(55, 53, 47, 0.4);',
    '--text-accent: #5b6be0;': '--text-accent: #2563EB;',

    '--accent-primary: #5b6be0;': '--accent-primary: #2563EB;',
    '--accent-primary-hover: #4a59d1;': '--accent-primary-hover: #1D4ED8;',
    '--accent-primary-bg: rgba(91, 107, 224, 0.1);': '--accent-primary-bg: rgba(37, 99, 235, 0.1);',
    '--accent-danger: #e53e3e;': '--accent-danger: #DC2626;',
    '--accent-danger-bg: rgba(229, 62, 62, 0.1);': '--accent-danger-bg: rgba(220, 38, 38, 0.1);',
    '--accent-success: #2f9e7f;': '--accent-success: #059669;',

    '--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);': '--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.03);',
    '--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);': '--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06);',
    '--shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.12);': '--shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.08);',
    '--shadow-glow: 0 0 20px rgba(91, 107, 224, 0.15);': '--shadow-glow: 0 0 20px rgba(37, 99, 235, 0.15);'
};

for (const [key, val] of Object.entries(replacements)) {
    indexCss = indexCss.replace(key, val);
}

// Special font replacement (multiline regex)
indexCss = indexCss.replace(/--font-sans: 'Noto Sans SC',[^;]+;/g, '--font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;');
indexCss = indexCss.replace(/--font-mono: 'JetBrains Mono',[^;]+;/g, '--font-mono: "JetBrains Mono", Consolas, Menlo, monospace;');

// Minimalist Borders: turn all btn borders into transparent until hover
// We will also widen line-heights globally
indexCss = indexCss.replace(/line-height: 1\.6;/g, 'line-height: 1.65;');

// App Title Minimalist adjustments instead of bold gradient
indexCss = indexCss.replace(/background: linear-gradient\(135deg, var\(--accent-primary\), #c084fc\);/g, 'background: var(--text-primary);');

fs.writeFileSync(path.join(cssDir, 'index.css'), indexCss);
console.log('index.css updated');

// ======================= SIDEBAR.CSS =======================
let sidebarCss = fs.readFileSync(path.join(cssDir, 'sidebar.css'), 'utf-8');

// remove unnecessary borders from search inputs and make background blend
sidebarCss = sidebarCss.replace(/padding: 12px 14px;\n\s+border-bottom: 1px solid var\(--border-subtle\);/g, 'padding: 16px 14px;\n    border-bottom: 1px solid transparent;');

// Make tabs flat like Notion
sidebarCss = sidebarCss.replace(/border: 1px solid var\(--border-default\);/g, 'border: 1px solid transparent;');

// pdf item flat initially
sidebarCss = sidebarCss.replace(/\.pdf-item {\n\s+display: flex;/g, '.pdf-item {\n    display: flex;\n    border: 1px solid transparent;');

fs.writeFileSync(path.join(cssDir, 'sidebar.css'), sidebarCss);
console.log('sidebar.css updated');

// ======================= PDF-VIEWER.CSS =======================
let viewerCss = fs.readFileSync(path.join(cssDir, 'pdf-viewer.css'), 'utf-8');

// remove toolbar background border for cleaner look
viewerCss = viewerCss.replace(/border-bottom: 1px solid var\(--border-subtle\);/g, 'border-bottom: 1px solid transparent;');
viewerCss = viewerCss.replace(/background: var\(--bg-secondary\);/g, 'background: var(--bg-primary);');

// update finding panel depth
viewerCss = viewerCss.replace(/box-shadow: var\(--shadow-lg\);/g, 'box-shadow: 0 12px 48px rgba(0, 0, 0, 0.12); /* Subtle floating depth */');

// give pdf wrapper a very soft shadow
viewerCss = viewerCss.replace(/box-shadow: var\(--shadow-lg\);/g, 'box-shadow: var(--shadow-sm); border: 1px solid var(--border-subtle);');

fs.writeFileSync(path.join(cssDir, 'pdf-viewer.css'), viewerCss);
console.log('pdf-viewer.css updated');

// ======================= NOTES.CSS =======================
let notesCss = fs.readFileSync(path.join(cssDir, 'notes.css'), 'utf-8');

// remove md-toolbar heavy borders
notesCss = notesCss.replace(/border: 1px solid var\(--border-default\);/g, 'border: 1px solid transparent;');

// fix fonts in markdown content
// let's do this directly in notes.css
notesCss += `
/* Notion-like Markdown typography */
.markdown-body {
    font-family: var(--font-sans) !important;
    line-height: 1.7 !important;
    color: var(--text-primary) !important;
}
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
    font-weight: 600 !important;
    border-bottom: none !important;
    margin-top: 1.5em !important;
}
.note-editor {
    font-family: var(--font-sans) !important;
    line-height: 1.7 !important;
    padding: 20px !important;
}
`;

fs.writeFileSync(path.join(cssDir, 'notes.css'), notesCss);
console.log('notes.css updated');
