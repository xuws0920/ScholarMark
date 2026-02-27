const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'src', 'styles');

// 1. sidebar.css: Move collapsed pill to vertical center
let sidebarCss = fs.readFileSync(path.join(cssDir, 'sidebar.css'), 'utf-8');

// The block we injected in phase 2 had `top: 60px; left: 12px;`
// We will replace `top: 60px;` with `top: 50%; transform: translateY(-50%);`
sidebarCss = sidebarCss.replace(/top: 60px;\s*\/\* Offset below header \*\//, 'top: 50%;\n    transform: translateY(-50%);\n    /* Centered to avoid overlap with popup panels */');

// Just in case the comment was removed manually:
sidebarCss = sidebarCss.replace(/top: 60px;/, 'top: 50%;\n    transform: translateY(-50%);');

fs.writeFileSync(path.join(cssDir, 'sidebar.css'), sidebarCss);
console.log('sidebar.css updated for Phase 3 (Centered Pill)');


// 2. pdf-viewer.css: Canvas & Toolbar Immersion
let viewerCss = fs.readFileSync(path.join(cssDir, 'pdf-viewer.css'), 'utf-8');

// Make toolbar background transparent instead of var(--bg-primary) or secondary
viewerCss = viewerCss.replace(/background: var\(--bg-primary\);/g, 'background: transparent; /* Phase 3 Canvas immersion */');
viewerCss = viewerCss.replace(/background: var\(--bg-secondary\);/g, 'background: transparent;');

// We defined styling for `.pdf-toolbar` in pdf-viewer.css
// Ensure toolbar is transparent and has NO border
viewerCss = viewerCss.replace(/\.pdf-toolbar \{[\s\S]*?\}/, `.pdf-toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    background: transparent !important;
    border-bottom: none !important;
    backdrop-filter: blur(4px); /* Slight glass effect on the toolbar space */
    z-index: 10;
    position: relative;
}`);

// Increase the physical paper feel for .pdf-page
// It usually has a class like `.pdf-page`
const pageStyleMatch = viewerCss.match(/\.pdf-page \{[\s\S]*?\}/);
if (pageStyleMatch) {
    let pageStyle = pageStyleMatch[0];
    // Remove old shadow/border if any
    pageStyle = pageStyle.replace(/box-shadow: [^;]+;/, '');
    pageStyle = pageStyle.replace(/border: [^;]+;/, '');

    // Inject the new strong page shadow
    // Also ensuring pure white background for the paper itself
    pageStyle = pageStyle.replace('}', '    background-color: #ffffff !important;\n    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0,0,0,0.04) !important;\n    border: none !important;\n}');
    viewerCss = viewerCss.replace(pageStyleMatch[0], pageStyle);
}

fs.writeFileSync(path.join(cssDir, 'pdf-viewer.css'), viewerCss);
console.log('pdf-viewer.css updated for Phase 3 (Toolbar Immersion & Paper Shadow)');

// 3. index.css: Update the overall wrapper backdrop for the PDF to be a subtle grey (like Notion/WPS) 
// instead of pure white/black, so the white paper pops out.
let indexCss = fs.readFileSync(path.join(cssDir, 'index.css'), 'utf-8');

// For light mode, make primary bg slightly grey so the white PDF page elevates
const lightModeRootIndex = indexCss.indexOf('[data-theme="light"]');
if (lightModeRootIndex !== -1) {
    // We already set --bg-primary: #FFFFFF; in phase 1. Let's revert the container bg to a very soft grey
    // Wait, the PDF container usually takes --bg-secondary or primary.
    // Let's explicitly target `--bg-primary: #FFFFFF;` inside the light theme and change it to `--bg-primary: #F9F9FB;`
    // And keep sidebar/elevated as #FFFFFF

    let lightModeBlock = indexCss.substring(lightModeRootIndex, indexCss.indexOf('}', lightModeRootIndex) + 1);

    lightModeBlock = lightModeBlock.replace(/--bg-primary: #FFFFFF;/g, '--bg-primary: #F7F7F9;');
    // Ensure secondary/elevated are pure white
    lightModeBlock = lightModeBlock.replace(/--bg-secondary: #[0-9A-Fa-f]+;/g, '--bg-secondary: #FFFFFF;');
    lightModeBlock = lightModeBlock.replace(/--bg-elevated: #[0-9A-Fa-f]+;/g, '--bg-elevated: #FFFFFF;');

    indexCss = indexCss.substring(0, lightModeRootIndex) + lightModeBlock + indexCss.substring(indexCss.indexOf('}', lightModeRootIndex) + 1);
}

fs.writeFileSync(path.join(cssDir, 'index.css'), indexCss);
console.log('index.css updated for Phase 3 (Canvas Backdrop Contrast)');
