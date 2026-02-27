const fs = require('fs');
const path = require('path');

const cssDir = path.join(__dirname, '..', 'src', 'styles');

// 1. sidebar.css
let sidebarCss = fs.readFileSync(path.join(cssDir, 'sidebar.css'), 'utf-8');

// The block we injected previously for collapsed state:
// #app-main.left-sidebar-collapsed #sidebar-left .sidebar-header {
//    display: none !important;
// }
// We need to replace this to only hide the title/tabs and import button

const oldHeaderHidden = /#app-main\.left-sidebar-collapsed #sidebar-left \.sidebar-header \{\s*display:\s*none\s*!important;\s*\}/g;

// Now we want the header to be visible, but we push the expand button out and down to the pill.
const newHeaderLogic = `
/* Phase 4: Show header but restructure contents when collapsed */
#app-main.left-sidebar-collapsed #sidebar-left .sidebar-header {
    display: flex !important;
    position: static;
    pointer-events: none; /* Let clicks pass through the invisible header parts */
}

/* Hide the tabs and import button */
#app-main.left-sidebar-collapsed .sidebar-tabs,
#app-main.left-sidebar-collapsed #btn-import-pdf {
    display: none !important;
}

/* Make the collapse/expand button absolute and position it inside the PILL */
#app-main.left-sidebar-collapsed #btn-toggle-left-sidebar {
    position: absolute !important;
    pointer-events: auto;
    /* Position exactly at the top center of our pill */
    top: 50%;
    transform: translateY(-50%) translateY(-33px) scaleX(-1) !important; /* Move to top of pill, AND flip the arrow right */
    left: 17px; /* Align with the pill icons */
    z-index: 101; /* Above the pill */
    
    /* Make it look like the other pill buttons */
    border-radius: 50%;
    border: none;
    background: transparent;
    padding: 6px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
}

#app-main.left-sidebar-collapsed #btn-toggle-left-sidebar:hover {
    background: var(--bg-hover) !important;
    color: var(--text-primary);
}
`;

sidebarCss = sidebarCss.replace(oldHeaderHidden, newHeaderLogic);

// Ensure the pill (#collapsed-entry-rail) has enough padding at the top to accommodate the absolute button
sidebarCss = sidebarCss.replace(/padding: 8px 6px !important;/g, 'padding: 42px 6px 8px !important; /* Phase 4: Top padding to house the expand button */');


// In the original sidebar.css (line 89 or so), we might have .collapsed-entry-rail { display: none; }
// Then in left-sidebar-collapsed it becomes display: flex.
// Let's ensure it's explicitly hidden when NOT collapsed:
if (!sidebarCss.includes('#sidebar-left:not(.left-sidebar-collapsed) #collapsed-entry-rail')) {
    sidebarCss += `
/* Phase 4 explicitly ensure pill is hidden when expanded */
#sidebar-left:not(.left-sidebar-collapsed) #collapsed-entry-rail {
    display: none !important;
}
`;
}


fs.writeFileSync(path.join(cssDir, 'sidebar.css'), sidebarCss);
console.log('sidebar.css updated for Phase 4 (Pill Expand Button Integrated)');
