const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'src', 'styles');

let viewerCss = fs.readFileSync(path.join(cssDir, 'pdf-viewer.css'), 'utf-8');

// 1. Toolbar background and border
viewerCss = viewerCss.replace(
    /background: transparent !important;/g,
    'background: var(--bg-secondary) !important;'
);
viewerCss = viewerCss.replace(
    /border-bottom: none !important;/g,
    'border-bottom: 1px solid var(--border-subtle) !important;'
);

// 2. Translation pane styling (paper feel)
viewerCss = viewerCss.replace(
    /background: transparent; \/\* Phase 3 Canvas immersion \*\//g,
    'background-color: #ffffff !important;\n    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0,0,0,0.04) !important;\n    border: none !important;'
);

// 3. Minimal padding for translation preview wrap
// Find padding: 14px; inside .pdf-translation-preview
const translationPreviewRegex = /\.pdf-translation-preview \{[\s\S]*?\}/;
const translationPreviewMatch = viewerCss.match(translationPreviewRegex);

if (translationPreviewMatch) {
    let oldPreview = translationPreviewMatch[0];
    let newPreview = oldPreview.replace(/padding: 14px;/, 'padding: 4px 10px; /* Phase 5: Minimal padding */');
    viewerCss = viewerCss.replace(oldPreview, newPreview);
}

fs.writeFileSync(path.join(cssDir, 'pdf-viewer.css'), viewerCss);
console.log('pdf-viewer.css updated for Phase 5');

// Update translation markdown body specifically for even less padding if standard is too large
// notes.css has .markdown-body padding. We can add a specific rule.
let notesCss = fs.readFileSync(path.join(cssDir, 'notes.css'), 'utf-8');
if (!notesCss.includes('#pdf-translation-preview.markdown-body')) {
    notesCss += `\n/* Phase 5 minimal padding specifically for translation pane */\n#pdf-translation-preview.markdown-body {\n    padding: 4px 8px;\n}\n`;
    fs.writeFileSync(path.join(cssDir, 'notes.css'), notesCss);
}
