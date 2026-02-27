const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'src', 'styles');

// 1. sidebar.css
let sidebarCss = fs.readFileSync(path.join(cssDir, 'sidebar.css'), 'utf-8');

// Remove border from sidebar
sidebarCss = sidebarCss.replace(/border-right: 1px solid var\(--border-subtle\);/g, 'border-right: none; /* Removed for borderless */');

// Modify left-sidebar-collapsed entirely
// We'll replace the block from `#app-main.left-sidebar-collapsed #sidebar-left {` up to `@media` or end
const collapsedTarget = /#app-main\.left-sidebar-collapsed #sidebar-left \{[\s\S]*?(?=@media)/;
const newCollapsedStyles = `#app-main.left-sidebar-collapsed #sidebar-left {
    width: 0 !important;
    min-width: 0 !important;
    max-width: 0 !important;
    border: none !important;
    overflow: visible !important;
}

#app-main.left-sidebar-collapsed #sidebar-left .sidebar-header {
    display: none !important;
}

#app-main.left-sidebar-collapsed #sidebar-left .collapsed-entry-rail {
    display: flex;
    position: absolute;
    top: 60px; /* Offset below header */
    left: 12px;
    background: color-mix(in srgb, var(--bg-secondary) 75%, transparent) !important;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-radius: 999px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), inset 0 0 0 1px var(--border-subtle);
    padding: 8px 6px !important;
    z-index: 100;
}

#app-main.left-sidebar-collapsed .collapsed-entry-btn {
    border-radius: 50%;
    border: none;
    background: transparent;
}

#app-main.left-sidebar-collapsed .collapsed-entry-btn:hover {
    background: var(--bg-hover);
}

#app-main.left-sidebar-collapsed .collapsed-entry-btn.active {
    background: var(--accent-primary-bg);
}

#app-main.left-sidebar-collapsed #resize-left {
    display: none;
}

`;

if (sidebarCss.match(collapsedTarget)) {
    sidebarCss = sidebarCss.replace(collapsedTarget, newCollapsedStyles);
} else {
    sidebarCss += '\n' + newCollapsedStyles;
}

fs.writeFileSync(path.join(cssDir, 'sidebar.css'), sidebarCss);
console.log('sidebar.css updated');


// 2. notes.css (Right Panel)
let notesCss = fs.readFileSync(path.join(cssDir, 'notes.css'), 'utf-8');

// Remove border-left
notesCss = notesCss.replace(/border-left: 1px solid var\(--border-subtle\);/g, 'border-left: none; /* Borderless */');

// Transform Tabs: workspace-btn
notesCss = notesCss.replace(/\.workspace-switch \{[\s\S]*?\}/, `.workspace-switch {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    border-bottom: 1px solid var(--border-subtle);
    margin: 0;
    padding-bottom: 0;
}`);

// workspace button override
notesCss = notesCss.replace(/\.workspace-btn \{[\s\S]*?\}/, `.workspace-btn {
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 0;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--transition-fast);
    position: relative;
}`);

notesCss = notesCss.replace(/\.workspace-btn:hover \{[\s\S]*?\}/, `.workspace-btn:hover {
    background: transparent !important;
    color: var(--text-primary) !important;
}`);

notesCss = notesCss.replace(/\.workspace-btn\.active \{[\s\S]*?\}/, `.workspace-btn.active {
    color: var(--text-primary) !important;
    background: transparent !important;
    border: none !important;
    font-weight: 600;
}
.workspace-btn.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 20%;
    right: 20%;
    height: 2px;
    background: var(--accent-primary);
    border-radius: 2px 2px 0 0;
}`);


// Inner tabs: tab-btn & summary-tab-btn
// We want to flatten them similarly.
const tabBtnReplace = `.tab-btn {
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--transition-fast);
    position: relative;
}
.tab-btn:hover {
    color: var(--text-primary) !important;
    background: transparent !important;
}
.tab-btn.active {
    color: var(--text-primary) !important;
    background: transparent !important;
    font-weight: 600;
}
.tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 15%;
    right: 15%;
    height: 2px;
    background: var(--accent-primary);
    border-radius: 2px;
}`;

notesCss = notesCss.replace(/\.tab-btn \{[\s\S]*?\}\s*\.tab-btn:hover \{[\s\S]*?\}\s*\.tab-btn\.active \{[\s\S]*?\}/, tabBtnReplace);


const summaryTabBtnReplace = `.summary-tab-btn {
    padding: 6px 12px;
    background: transparent;
    border: none;
    color: var(--text-tertiary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: color var(--transition-fast);
    position: relative;
}
.summary-tab-btn:hover {
    color: var(--text-primary) !important;
    background: transparent !important;
}
.summary-tab-btn.active {
    color: var(--text-primary) !important;
    background: transparent !important;
    font-weight: 600;
}
.summary-tab-btn.active::after {
    content: '';
    position: absolute;
    bottom: -4px;
    left: 15%;
    right: 15%;
    height: 2px;
    background: var(--accent-primary);
    border-radius: 2px;
}`;
notesCss = notesCss.replace(/\.summary-tab-btn \{[\s\S]*?\}\s*\.summary-tab-btn:hover \{[\s\S]*?\}\s*\.summary-tab-btn\.active \{[\s\S]*?\}/, summaryTabBtnReplace);

// Notes content header flattening. 
// Just ensuring `notes-tabs` wrapper flows naturally
notesCss = notesCss.replace(/\.notes-tabs \{[\s\S]*?\}/, `.notes-tabs {
    display: flex;
    gap: 12px;
    border-bottom: 1px solid transparent;
}`);

fs.writeFileSync(path.join(cssDir, 'notes.css'), notesCss);
console.log('notes.css updated');

// 3. index.css (resize handle hide visually but keep functional)
let indexCss = fs.readFileSync(path.join(cssDir, 'index.css'), 'utf-8');
indexCss = indexCss.replace(/\.resize-handle:hover,\s*\.resize-handle\.active\s*\{[\s\S]*?\}/, `.resize-handle:hover,\n.resize-handle.active {\n    background: color-mix(in srgb, var(--border-strong) 40%, transparent);\n}`);

fs.writeFileSync(path.join(cssDir, 'index.css'), indexCss);
console.log('index.css updated');
