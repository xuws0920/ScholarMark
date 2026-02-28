import G6 from '@antv/g6';
import { $, createElement, debounce } from '../utils/dom.js';
import { attachMarkdownToolbar } from '../utils/markdown-toolbar.js';
import * as storage from './storage.js';

const ACTIVE_GRAPH_KEY = 'scholarmarkActiveGraphId';
const ANCHOR_NAMES = ['top', 'right', 'bottom', 'left'];
const ANCHOR_THRESHOLD_PX = 16;
const DEFAULT_NODE_SIZE = [240, 84];
const EDGE_STUB = 22;
const EDGE_ENDPOINT_BUFFER = 18;
const EDGE_CLEARANCE = 20;
const ARROW_OFFSET = 4;

let graphInstance = null;
let overviewGraphInstance = null;
let graphs = [];
let currentGraph = null;
let currentGraphId = localStorage.getItem(ACTIVE_GRAPH_KEY) || null;
let currentPdfContext = null;
let graphSnapshot = { nodes: [], edges: [] };
let globalOverviewSnapshot = { nodes: [], edges: [] };
let globalOverviewIndex = new Map();
let selectedItem = { type: 'none', id: null };
let uiCallbacks = {
    onOpenPdf: null,
    onActivateGraphTab: null,
    onCloseGraph: null
};
let suppressNodeForm = false;
let suppressEdgeForm = false;
let hoveredNodeId = null;
let activeTargetAnchor = null;
let edgeOverlay = null;
let overlaySvg = null;
let overlayHandlesGroup = null;
let overlayPreviewGroup = null;
let dragSession = null;
let selectedOverviewDocId = null;

const persistSelectedNodeDebounced = debounce(async () => {
    if (selectedItem.type !== 'node' || !selectedItem.id) return;
    const node = graphSnapshot.nodes.find((item) => item.id === selectedItem.id);
    if (!node) return;

    node.title = $('#graph-node-title-input')?.value.trim() || '';
    node.authors = $('#graph-node-authors-input')?.value.trim() || '';
    node.year = $('#graph-node-year-input')?.value.trim() || '';
    await storage.updateGraphNode(node);
    updateGraphNodeVisual(node);
    await refreshGraphList();
}, 350);

const persistSelectedEdgeDebounced = debounce(async () => {
    if (selectedItem.type !== 'edge' || !selectedItem.id) return;
    const edge = graphSnapshot.edges.find((item) => item.id === selectedItem.id);
    if (!edge) return;

    edge.label = $('#graph-edge-label-input')?.value.trim() || '';
    edge.details = $('#graph-edge-details-input')?.value || '';
    await storage.updateGraphEdge(edge);
    updateGraphEdgeVisual(edge);
    await refreshGraphList();
}, 350);

export async function initGraphWorkspace(callbacks = {}) {
    uiCallbacks = { ...uiCallbacks, ...callbacks };
    bindGraphWorkspaceEvents();
    attachMarkdownToolbar($('#graph-edge-details-input'));
    await refreshGraphList();

    if (currentGraphId && graphs.some((graph) => graph.id === currentGraphId)) {
        await openGraphById(currentGraphId);
    } else if (graphs.length) {
        await openGraphById(graphs[0].id);
    } else {
        renderGraphEmptyState();
    }
}

export function setCurrentGraphPdfContext(pdfContext) {
    currentPdfContext = pdfContext
        ? {
            id: pdfContext.id,
            name: pdfContext.name || 'Untitled PDF'
        }
        : null;

    const addBtn = $('#btn-add-current-to-graph');
    if (addBtn) {
        addBtn.disabled = !currentPdfContext;
        addBtn.title = currentPdfContext ? '加入图谱' : '请先打开一篇文献';
    }

    const label = $('#graph-add-current-doc');
    if (label) {
        label.textContent = currentPdfContext
            ? `当前文献：${currentPdfContext.name}`
            : '当前文献：请先打开一篇文献';
    }
}

export async function openGraphWorkspaceView() {
    $('#graph-library-view').style.display = 'block';
    await refreshGraphList();

    if (currentGraphId && graphs.some((graph) => graph.id === currentGraphId)) {
        await openGraphById(currentGraphId);
    } else if (graphs.length) {
        await openGraphById(graphs[0].id);
    } else {
        renderGraphEmptyState();
    }

    requestAnimationFrame(() => {
        resizeGraphCanvas();
        resizeOverviewGraph();
    });
}

export function closeGraphWorkspaceView() {
    $('#graph-library-view').style.display = 'none';
    closeAddToGraphModal();
    closeOverviewJumpModal();
    clearDragSession();
}

async function refreshGraphList() {
    graphs = await storage.getAllGraphs();
    renderGraphDirectory();
    renderAddToGraphList();
    await refreshGlobalOverview();

    const counter = $('#graph-library-counter');
    if (counter) {
        counter.textContent = `${graphs.length} 张图谱`;
    }

    if (currentGraphId && !graphs.some((graph) => graph.id === currentGraphId)) {
        currentGraphId = null;
        currentGraph = null;
        localStorage.removeItem(ACTIVE_GRAPH_KEY);
    }

    syncGraphToolbarState();
}

function bindGraphWorkspaceEvents() {
    $('#btn-create-graph')?.addEventListener('click', async () => {
        const graph = await promptCreateGraph();
        if (graph) await openGraphById(graph.id);
    });

    $('#btn-create-graph-from-modal')?.addEventListener('click', async () => {
        const graph = await promptCreateGraph();
        if (!graph) return;
        await refreshGraphList();
        await addCurrentPdfToGraph(graph.id);
    });

    $('#btn-close-graph-library')?.addEventListener('click', () => {
        uiCallbacks.onCloseGraph?.();
    });

    $('#btn-close-graph-add-modal')?.addEventListener('click', closeAddToGraphModal);
    $('#graph-add-modal .modal-overlay')?.addEventListener('click', closeAddToGraphModal);
    $('#btn-close-graph-overview-jump-modal')?.addEventListener('click', closeOverviewJumpModal);
    $('#graph-overview-jump-modal .modal-overlay')?.addEventListener('click', closeOverviewJumpModal);

    $('#btn-add-current-to-graph')?.addEventListener('click', async () => {
        await openAddToGraphModal();
    });

    $('#btn-rename-graph')?.addEventListener('click', async () => {
        if (!currentGraph) return;
        const nextName = window.prompt('请输入图谱名称', currentGraph.name || '');
        if (nextName === null) return;
        const trimmed = nextName.trim();
        if (!trimmed) {
            alert('图谱名称不能为空');
            return;
        }
        currentGraph.name = trimmed;
        currentGraph = await storage.updateGraph(currentGraph);
        await refreshGraphList();
        renderCurrentGraphMeta();
    });

    $('#btn-delete-graph')?.addEventListener('click', async () => {
        if (!currentGraph) return;
        if (!confirm(`确定删除图谱“${currentGraph.name}”吗？`)) return;
        await storage.deleteGraph(currentGraph.id);
        currentGraphId = null;
        currentGraph = null;
        localStorage.removeItem(ACTIVE_GRAPH_KEY);
        graphSnapshot = { nodes: [], edges: [] };
        clearSelection();
        if (graphInstance) {
            graphInstance.changeData({ nodes: [], edges: [] });
        }
        await refreshGraphList();
        renderGraphEmptyState();
    });

    $('#btn-graph-auto-layout')?.addEventListener('click', async () => {
        await autoLayoutCurrentGraph();
    });

    $('#btn-delete-graph-node')?.addEventListener('click', async () => {
        if (selectedItem.type !== 'node') return;
        const node = graphSnapshot.nodes.find((item) => item.id === selectedItem.id);
        if (!node) return;
        if (!confirm('确定删除这个文献节点及其关联连线吗？')) return;
        await storage.deleteGraphNode(node.id);
        await reloadCurrentGraph();
        clearSelection();
    });

    $('#btn-delete-graph-edge')?.addEventListener('click', async () => {
        if (selectedItem.type !== 'edge') return;
        const edge = graphSnapshot.edges.find((item) => item.id === selectedItem.id);
        if (!edge) return;
        if (!confirm('确定删除这条连线吗？')) return;
        await storage.deleteGraphEdge(edge.id);
        await reloadCurrentGraph();
        clearSelection();
    });

    $('#btn-graph-open-pdf')?.addEventListener('click', async () => {
        if (selectedItem.type !== 'node') return;
        const node = graphSnapshot.nodes.find((item) => item.id === selectedItem.id);
        if (!node?.docId) {
            alert('该节点没有关联文献');
            return;
        }
        closeGraphWorkspaceView();
        await uiCallbacks.onOpenPdf?.(node.docId);
    });

    $('#graph-node-title-input')?.addEventListener('input', () => {
        if (!suppressNodeForm) persistSelectedNodeDebounced();
    });
    $('#graph-node-authors-input')?.addEventListener('input', () => {
        if (!suppressNodeForm) persistSelectedNodeDebounced();
    });
    $('#graph-node-year-input')?.addEventListener('input', () => {
        if (!suppressNodeForm) persistSelectedNodeDebounced();
    });

    $('#graph-edge-label-input')?.addEventListener('input', () => {
        if (suppressEdgeForm) return;
        const edge = graphSnapshot.edges.find((item) => item.id === selectedItem.id);
        if (!edge) return;
        edge.label = $('#graph-edge-label-input').value.trim();
        updateGraphEdgeVisual(edge);
        renderEdgeOverlay();
        persistSelectedEdgeDebounced();
    });
    $('#graph-edge-details-input')?.addEventListener('input', () => {
        if (!suppressEdgeForm) persistSelectedEdgeDebounced();
    });

    window.addEventListener('resize', () => {
        resizeGraphCanvas();
        resizeOverviewGraph();
    });
}

async function promptCreateGraph() {
    const input = window.prompt('请输入图谱名称', `研究方向 ${graphs.length + 1}`);
    if (input === null) return null;
    const name = input.trim();
    if (!name) {
        alert('图谱名称不能为空');
        return null;
    }
    const graph = await storage.createGraph(name);
    currentGraphId = graph.id;
    localStorage.setItem(ACTIVE_GRAPH_KEY, graph.id);
    await refreshGraphList();
    return graph;
}

async function openAddToGraphModal() {
    if (!currentPdfContext) {
        alert('请先打开一篇文献');
        return;
    }

    await refreshGraphList();
    $('#graph-add-modal').style.display = 'flex';
}

function closeAddToGraphModal() {
    $('#graph-add-modal').style.display = 'none';
}

function closeOverviewJumpModal() {
    $('#graph-overview-jump-modal').style.display = 'none';
}

function renderGraphDirectory() {
    const container = $('#graph-directory-list');
    if (!container) return;

    if (!graphs.length) {
        container.innerHTML = '<p class="empty-hint">暂无图谱</p>';
        return;
    }

    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    graphs.forEach((graph) => {
        const button = createElement('button', {
            type: 'button',
            className: `graph-directory-item${graph.id === currentGraphId ? ' active' : ''}`
        }, [
            createElement('div', { className: 'graph-directory-name', textContent: graph.name || '未命名图谱' }),
            createElement('div', { className: 'graph-directory-meta', textContent: formatGraphMeta(graph) })
        ]);
        button.addEventListener('click', async () => {
            await openGraphById(graph.id);
        });
        fragment.appendChild(button);
    });
    container.appendChild(fragment);
}

function renderAddToGraphList() {
    const container = $('#graph-add-list');
    if (!container) return;

    if (!graphs.length) {
        container.innerHTML = '<p class="empty-hint">暂无图谱，请先创建</p>';
        return;
    }

    container.innerHTML = '';
    const fragment = document.createDocumentFragment();
    graphs.forEach((graph) => {
        const button = createElement('button', {
            type: 'button',
            className: 'graph-add-item'
        }, [
            createElement('div', { className: 'graph-directory-name', textContent: graph.name || '未命名图谱' }),
            createElement('div', { className: 'graph-directory-meta', textContent: formatGraphMeta(graph) })
        ]);
        button.addEventListener('click', async () => {
            await addCurrentPdfToGraph(graph.id);
        });
        fragment.appendChild(button);
    });
    container.appendChild(fragment);
}

async function addCurrentPdfToGraph(graphId) {
    if (!currentPdfContext) return;

    const existing = await storage.getGraphNodeByDocId(graphId, currentPdfContext.id);
    if (existing) {
        closeAddToGraphModal();
        uiCallbacks.onActivateGraphTab?.();
        await openGraphById(graphId);
        selectNode(existing.id);
        alert('该文献已存在于当前图谱中');
        return;
    }

    const nodes = await storage.getGraphNodes(graphId);
    const position = getSuggestedPosition(nodes);
    const node = await storage.addGraphNode({
        graphId,
        docId: currentPdfContext.id,
        title: currentPdfContext.name,
        authors: '',
        year: '',
        x: position.x,
        y: position.y
    });

    closeAddToGraphModal();
    uiCallbacks.onActivateGraphTab?.();
    await refreshGraphList();
    await openGraphById(graphId);
    selectNode(node.id);
}

async function openGraphById(graphId) {
    const graph = graphs.find((item) => item.id === graphId) || await storage.getGraph(graphId);
    if (!graph) {
        renderGraphEmptyState();
        return;
    }

    currentGraph = graph;
    currentGraphId = graph.id;
    localStorage.setItem(ACTIVE_GRAPH_KEY, graph.id);
    graphSnapshot = await loadGraphSnapshot(graph.id);

    renderCurrentGraphMeta();
    syncGraphToolbarState();
    await ensureGraphInstance();
    renderGraphWorkspace();
    clearSelection();
}

async function loadGraphSnapshot(graphId) {
    const nodes = await storage.getGraphNodes(graphId);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges = (await storage.getGraphEdges(graphId)).map((edge) => normalizeEdge(edge, nodeById));
    return { nodes, edges };
}

async function reloadCurrentGraph() {
    if (!currentGraphId) return;
    currentGraph = await storage.getGraph(currentGraphId);
    graphSnapshot = await loadGraphSnapshot(currentGraphId);
    renderCurrentGraphMeta();
    renderGraphWorkspace();
    await refreshGraphList();
}

function renderCurrentGraphMeta() {
    $('#graph-active-name').textContent = currentGraph?.name || '请选择图谱';
}

function renderGraphEmptyState() {
    $('#graph-empty-state').style.display = 'flex';
    $('#graph-workspace-main').style.display = 'none';
    $('#graph-active-name').textContent = '请选择图谱';
    syncGraphToolbarState();
    renderStats();
    renderEdgeOverlay();
    renderGlobalOverview();
}

function renderGraphWorkspace() {
    if (!currentGraph) {
        renderGraphEmptyState();
        return;
    }

    $('#graph-empty-state').style.display = 'none';
    $('#graph-workspace-main').style.display = 'grid';
    renderStats();
    renderGlobalOverview();
    if (!graphInstance) return;

    graphInstance.changeData({
        nodes: graphSnapshot.nodes.map(toG6NodeModel),
        edges: graphSnapshot.edges.map(toG6EdgeModel)
    });
    graphInstance.render();
    hideAllNodeAnchors();
    resizeGraphCanvas();
    refreshSelectedNodeAnchors();
}

async function ensureGraphInstance() {
    if (graphInstance) return;

    const container = $('#graph-canvas-container');
    const width = Math.max(320, container.clientWidth || 960);
    const height = Math.max(320, container.clientHeight || 640);

    graphInstance = new G6.Graph({
        container,
        width,
        height,
        fitCenter: false,
        linkCenter: false,
        defaultNode: {
            type: 'rect',
            size: DEFAULT_NODE_SIZE,
            anchorPoints: [
                [0.5, -(ARROW_OFFSET / DEFAULT_NODE_SIZE[1])],
                [1 + ARROW_OFFSET / DEFAULT_NODE_SIZE[0], 0.5],
                [0.5, 1 + ARROW_OFFSET / DEFAULT_NODE_SIZE[1]],
                [-(ARROW_OFFSET / DEFAULT_NODE_SIZE[0]), 0.5]
            ],
            style: {
                radius: 14,
                fill: '#1f2937',
                stroke: '#4b5563',
                lineWidth: 1.2,
                shadowColor: 'rgba(0,0,0,0.25)',
                shadowBlur: 14
            },
            labelCfg: {
                style: {
                    fill: '#f8fafc',
                    fontSize: 13,
                    lineHeight: 18,
                    fontWeight: 500
                }
            }
        },
        defaultEdge: {
            type: 'polyline',
            style: {
                radius: 10,
                offset: 18,
                stroke: '#94a3b8',
                lineWidth: 1.8,
                endArrow: {
                    path: G6.Arrow.triangle(10, 12, 4),
                    d: 6,
                    fill: '#94a3b8'
                }
            },
            labelCfg: {
                autoRotate: false,
                refY: -10,
                style: {
                    fill: '#cbd5e1',
                    background: {
                        fill: 'rgba(15, 23, 42, 0.85)',
                        radius: 4,
                        padding: [3, 6, 3, 6]
                    }
                }
            }
        },
        nodeStateStyles: {
            selected: {
                fill: '#1f2937',
                stroke: '#60a5fa',
                lineWidth: 2.5,
                shadowColor: 'rgba(96, 165, 250, 0.4)',
                shadowBlur: 18
            },
            active: {
                fill: '#1f2937',
                stroke: '#93c5fd',
                lineWidth: 2,
                shadowColor: 'rgba(147, 197, 253, 0.3)',
                shadowBlur: 12
            }
        },
        edgeStateStyles: {
            selected: {
                stroke: '#60a5fa',
                lineWidth: 2.6
            }
        },
        modes: {
            default: ['drag-canvas', 'zoom-canvas', 'drag-node']
        }
    });

    ensureOverlay(container);

    graphInstance.on('node:click', (evt) => {
        if (dragSession) return;
        const item = evt.item;
        if (!item) return;
        selectNode(item.getID());
    });

    graphInstance.on('edge:click', (evt) => {
        if (dragSession) return;
        const item = evt.item;
        if (!item) return;
        selectEdge(item.getID());
    });

    graphInstance.on('canvas:click', () => {
        if (dragSession) return;
        clearSelection();
    });

    graphInstance.on('node:mouseenter', (evt) => {
        const item = evt.item;
        if (!item) return;
        hoveredNodeId = item.getID();
        graphInstance.setItemState(item, 'active', true);
        showNodeAnchors(item.getID());
        applyAnchorHighlights();
    });

    graphInstance.on('node:mouseleave', (evt) => {
        const item = evt.item;
        if (!item) return;
        if (hoveredNodeId === item.getID()) hoveredNodeId = null;
        if (!dragSession || dragSession.sourceNodeId !== item.getID()) {
            graphInstance.setItemState(item, 'active', false);
            hideNodeAnchorsIfNeeded(item.getID());
        }
        applyAnchorHighlights();
    });

    graphInstance.on('node:mousedown', (evt) => {
        const anchorIndex = getAnchorIndexFromTarget(evt.target);
        const item = evt.item;
        if (!item || anchorIndex < 0) return;
        evt.preventDefault?.();
        startAnchorDrag({
            mode: 'create',
            sourceNodeId: item.getID(),
            sourceAnchor: anchorIndex,
            originEvent: evt
        });
    });

    graphInstance.on('node:dragend', async (evt) => {
        const item = evt.item;
        if (!item) return;
        const node = graphSnapshot.nodes.find((entry) => entry.id === item.getID());
        const model = item.getModel();
        if (!node || !Number.isFinite(model.x) || !Number.isFinite(model.y)) return;
        node.x = model.x;
        node.y = model.y;
        await storage.updateGraphNode(node);
        await refreshConnectedEdgesForNode(node.id);
        await refreshGraphList();
        renderEdgeOverlay();
    });

    graphInstance.on('viewportchange', () => {
        renderEdgeOverlay();
    });

    graphInstance.on('afterrender', () => {
        renderEdgeOverlay();
    });
}

async function ensureOverviewGraphInstance() {
    if (overviewGraphInstance) return;

    const container = $('#graph-global-overview');
    if (!container) return;
    const width = Math.max(240, container.clientWidth || 300);
    const height = Math.max(240, container.clientHeight || 320);

    overviewGraphInstance = new G6.Graph({
        container,
        width,
        height,
        fitView: true,
        fitCenter: true,
        linkCenter: true,
        layout: {
            type: 'force',
            preventOverlap: true,
            nodeSpacing: 10,
            linkDistance: 74,
            nodeStrength: -180,
            edgeStrength: 0.08
        },
        defaultNode: {
            type: 'circle',
            size: 10,
            style: {
                fill: '#94a3b8',
                stroke: '#e2e8f0',
                lineWidth: 1
            },
            labelCfg: {
                position: 'bottom',
                offset: 10,
                style: {
                    fill: '#111827',
                    fontSize: 12,
                    fontWeight: 500
                }
            }
        },
        defaultEdge: {
            type: 'line',
            style: {
                stroke: 'rgba(148, 163, 184, 0.45)',
                lineWidth: 1
            }
        },
        nodeStateStyles: {
            active: {
                fill: '#60a5fa',
                stroke: '#f8fafc',
                lineWidth: 1.5
            },
            selected: {
                fill: '#3b82f6',
                stroke: '#f8fafc',
                lineWidth: 2
            }
        },
        modes: {
            default: ['drag-canvas', 'zoom-canvas']
        }
    });

    overviewGraphInstance.on('node:mouseenter', (evt) => {
        const item = evt.item;
        if (!item) return;
        overviewGraphInstance.setItemState(item, 'active', true);
        updateOverviewNodeLabel(item.getID(), true);
    });

    overviewGraphInstance.on('node:mouseleave', (evt) => {
        const item = evt.item;
        if (!item) return;
        overviewGraphInstance.setItemState(item, 'active', false);
        updateOverviewNodeLabel(item.getID(), false);
    });

    overviewGraphInstance.on('node:click', async (evt) => {
        const item = evt.item;
        if (!item) return;
        selectOverviewNode(item.getID());
        await handleOverviewNodeOpen(item.getID());
    });

    overviewGraphInstance.on('canvas:click', () => {
        clearOverviewSelection();
    });

    overviewGraphInstance.on('afterlayout', () => {
        overviewGraphInstance.fitView(20);
    });
}

function ensureOverlay(container) {
    if (edgeOverlay) return;

    edgeOverlay = document.createElement('div');
    edgeOverlay.className = 'graph-edge-overlay';
    edgeOverlay.innerHTML = `
      <svg class="graph-edge-overlay-svg">
        <g data-layer="preview"></g>
        <g data-layer="handles"></g>
      </svg>
    `;
    container.appendChild(edgeOverlay);
    overlaySvg = edgeOverlay.querySelector('svg');
    overlayPreviewGroup = edgeOverlay.querySelector('[data-layer="preview"]');
    overlayHandlesGroup = edgeOverlay.querySelector('[data-layer="handles"]');
}

function resizeGraphCanvas() {
    if (!graphInstance || $('#graph-library-view').style.display === 'none') return;
    const container = $('#graph-canvas-container');
    if (!container) return;
    const width = Math.max(320, container.clientWidth || 960);
    const height = Math.max(320, container.clientHeight || 640);
    graphInstance.changeSize(width, height);
    if (overlaySvg) {
        overlaySvg.setAttribute('width', String(width));
        overlaySvg.setAttribute('height', String(height));
        overlaySvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    renderEdgeOverlay();
}

function resizeOverviewGraph() {
    if (!overviewGraphInstance || $('#graph-library-view').style.display === 'none') return;
    const container = $('#graph-global-overview');
    if (!container) return;
    const width = Math.max(240, container.clientWidth || 300);
    const height = Math.max(240, container.clientHeight || 320);
    overviewGraphInstance.changeSize(width, height);
    overviewGraphInstance.fitView(20);
}

function toG6NodeModel(node) {
    return {
        id: node.id,
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        size: DEFAULT_NODE_SIZE,
        anchorPoints: [
            [0.5, -(ARROW_OFFSET / DEFAULT_NODE_SIZE[1])],
            [1 + ARROW_OFFSET / DEFAULT_NODE_SIZE[0], 0.5],
            [0.5, 1 + ARROW_OFFSET / DEFAULT_NODE_SIZE[1]],
            [-(ARROW_OFFSET / DEFAULT_NODE_SIZE[0]), 0.5]
        ],
        label: formatNodeLabel(node),
        linkPoints: {
            top: false,
            right: false,
            bottom: false,
            left: false,
            size: 8,
            fill: '#f8fafc',
            stroke: '#60a5fa',
            lineWidth: 2
        }
    };
}

function toG6EdgeModel(edge) {
    const model = {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceAnchor: edge.sourceAnchor,
        targetAnchor: edge.targetAnchor,
        label: edge.label || ''
    };
    if (Array.isArray(edge.controlPoints) && edge.controlPoints.length) {
        model.controlPoints = edge.controlPoints;
    }
    return model;
}

function normalizeEdge(edge, nodeById) {
    const sourceNode = nodeById.get(edge.sourceNodeId);
    const targetNode = nodeById.get(edge.targetNodeId);

    // Always re-infer optimal anchors for auto-routed edges
    const isManual = !!edge.manualRouting;
    const sourceAnchor = (isManual && Number.isInteger(edge.sourceAnchor))
        ? edge.sourceAnchor
        : inferNodeAnchorFromDirection(sourceNode, targetNode);
    const targetAnchor = (isManual && Number.isInteger(edge.targetAnchor))
        ? edge.targetAnchor
        : inferNodeAnchorFromDirection(targetNode, sourceNode);

    // Always recompute control points for auto-routed edges
    const controlPoints = (isManual && Array.isArray(edge.controlPoints) && edge.controlPoints.length)
        ? edge.controlPoints.map(clonePoint)
        : computeOrthogonalControlPoints(
            getGraphAnchorPointFromNode(sourceNode, sourceAnchor),
            getGraphAnchorPointFromNode(targetNode, targetAnchor),
            sourceAnchor,
            targetAnchor,
            edge.sourceNodeId,
            edge.targetNodeId
        );

    return {
        ...edge,
        sourceAnchor,
        targetAnchor,
        controlPoints,
        manualRouting: isManual
    };
}

function updateGraphNodeVisual(node) {
    if (!graphInstance) return;
    const item = graphInstance.findById(node.id);
    if (!item) return;
    graphInstance.updateItem(item, {
        label: formatNodeLabel(node)
    });
}

function updateGraphEdgeVisual(edge) {
    if (!graphInstance) return;
    const item = graphInstance.findById(edge.id);
    if (!item) return;
    graphInstance.updateItem(item, toG6EdgeModel(edge));
}

function formatNodeLabel(node) {
    const title = truncateText(node.title || '未命名文献', 28);
    const meta = [];
    if (node.authors) meta.push(truncateText(node.authors, 30));
    if (node.year) meta.push(node.year);
    return meta.length ? `${title}\n${meta.join(' · ')}` : title;
}

function truncateText(text, limit = 24) {
    const value = String(text || '').trim();
    if (value.length <= limit) return value;
    return `${value.slice(0, limit - 1)}…`;
}

function getSuggestedPosition(nodes) {
    const container = $('#graph-canvas-container');
    const width = Math.max(800, container?.clientWidth || 960);
    const height = Math.max(520, container?.clientHeight || 640);

    if (!nodes.length) {
        return { x: width / 2, y: height / 2 };
    }

    const index = nodes.length;
    const column = index % 3;
    const row = Math.floor(index / 3);
    return {
        x: 180 + column * 290 + (row % 2) * 22,
        y: 120 + row * 160
    };
}

async function autoLayoutCurrentGraph() {
    if (!currentGraph || !graphSnapshot.nodes.length) return;

    const container = $('#graph-canvas-container');
    const width = Math.max(800, container?.clientWidth || 960);
    const height = Math.max(520, container?.clientHeight || 640);
    const positions = buildAutoLayout(graphSnapshot.nodes, graphSnapshot.edges, width, height);

    await Promise.all(graphSnapshot.nodes.map(async (node) => {
        const nextPos = positions.get(node.id);
        if (!nextPos) return;
        node.x = nextPos.x;
        node.y = nextPos.y;
        await storage.updateGraphNode(node);
    }));

    await Promise.all(graphSnapshot.edges.map(async (edge) => {
        const next = refreshEdgeRoute(edge, false);
        await storage.updateGraphEdge(next);
    }));

    await reloadCurrentGraph();
}

function buildAutoLayout(nodes, edges, width, height) {
    const indegree = new Map();
    const adjacency = new Map();
    nodes.forEach((node) => {
        indegree.set(node.id, 0);
        adjacency.set(node.id, []);
    });
    edges.forEach((edge) => {
        adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
        indegree.set(edge.targetNodeId, (indegree.get(edge.targetNodeId) || 0) + 1);
    });

    const queue = [];
    indegree.forEach((count, nodeId) => {
        if (count === 0) queue.push(nodeId);
    });

    const levels = new Map();
    queue.forEach((nodeId) => levels.set(nodeId, 0));

    while (queue.length) {
        const nodeId = queue.shift();
        const currentLevel = levels.get(nodeId) || 0;
        (adjacency.get(nodeId) || []).forEach((nextId) => {
            levels.set(nextId, Math.max(levels.get(nextId) || 0, currentLevel + 1));
            indegree.set(nextId, (indegree.get(nextId) || 1) - 1);
            if (indegree.get(nextId) === 0) queue.push(nextId);
        });
    }

    nodes.forEach((node, index) => {
        if (!levels.has(node.id)) levels.set(node.id, index);
    });

    const grouped = new Map();
    nodes.forEach((node) => {
        const level = levels.get(node.id) || 0;
        if (!grouped.has(level)) grouped.set(level, []);
        grouped.get(level).push(node.id);
    });

    const positions = new Map();
    Array.from(grouped.keys()).sort((a, b) => a - b).forEach((level, levelIndex) => {
        const ids = grouped.get(level) || [];
        const usableHeight = Math.max(240, height - 140);
        const gap = ids.length > 1 ? usableHeight / (ids.length - 1) : 0;
        ids.forEach((nodeId, idx) => {
            positions.set(nodeId, {
                x: 160 + levelIndex * 280,
                y: ids.length > 1 ? 90 + idx * gap : height / 2
            });
        });
    });

    return positions;
}

function selectNode(nodeId) {
    selectedItem = { type: 'node', id: nodeId };
    syncSelectionState();
    const node = graphSnapshot.nodes.find((item) => item.id === nodeId);
    if (!node) {
        clearSelection();
        return;
    }

    suppressNodeForm = true;
    $('#graph-node-title-input').value = node.title || '';
    $('#graph-node-authors-input').value = node.authors || '';
    $('#graph-node-year-input').value = node.year || '';
    suppressNodeForm = false;

    setInspectorPanel('node');
    renderEdgeOverlay();
}

function selectEdge(edgeId) {
    selectedItem = { type: 'edge', id: edgeId };
    syncSelectionState();
    const edge = graphSnapshot.edges.find((item) => item.id === edgeId);
    if (!edge) {
        clearSelection();
        return;
    }

    const source = graphSnapshot.nodes.find((node) => node.id === edge.sourceNodeId);
    const target = graphSnapshot.nodes.find((node) => node.id === edge.targetNodeId);
    $('#graph-edge-direction').textContent = `${source?.title || '文献 A'} → ${target?.title || '文献 B'}`;

    suppressEdgeForm = true;
    $('#graph-edge-label-input').value = edge.label || '';
    $('#graph-edge-details-input').value = edge.details || '';
    suppressEdgeForm = false;

    setInspectorPanel('edge');
    renderEdgeOverlay();
}

function clearSelection() {
    selectedItem = { type: 'none', id: null };
    syncSelectionState();
    setInspectorPanel('empty');
    renderEdgeOverlay();
}

function syncSelectionState() {
    if (!graphInstance) return;

    graphSnapshot.nodes.forEach((node) => {
        const item = graphInstance.findById(node.id);
        if (item) {
            graphInstance.setItemState(item, 'selected', selectedItem.type === 'node' && selectedItem.id === node.id);
        }
    });

    graphSnapshot.edges.forEach((edge) => {
        const item = graphInstance.findById(edge.id);
        if (item) {
            graphInstance.setItemState(item, 'selected', selectedItem.type === 'edge' && selectedItem.id === edge.id);
        }
    });
}

function setInspectorPanel(type) {
    ['empty', 'node', 'edge'].forEach((panelType) => {
        $(`#graph-panel-${panelType}`)?.classList.toggle('graph-panel-active', panelType === type);
    });
}

function renderStats() {
    const stats = $('#graph-stats');
    if (!stats) return;
    stats.innerHTML = '';

    const cards = [
        { label: '文献节点', value: String(graphSnapshot.nodes.length) },
        { label: '演进连线', value: String(graphSnapshot.edges.length) },
        { label: '当前文献', value: currentPdfContext ? '已打开' : '未打开' }
    ];

    cards.forEach((card) => {
        stats.appendChild(createElement('div', { className: 'graph-stat-card' }, [
            createElement('div', { className: 'graph-stat-value', textContent: card.value }),
            createElement('div', { className: 'graph-stat-label', textContent: card.label })
        ]));
    });
}

async function refreshGlobalOverview() {
    globalOverviewSnapshot = await buildGlobalOverviewSnapshot();
    renderGlobalOverview();
}

async function buildGlobalOverviewSnapshot() {
    if (!graphs.length) {
        globalOverviewIndex = new Map();
        return { nodes: [], edges: [] };
    }

    const [allNodes, allEdges] = await Promise.all([
        Promise.all(graphs.map((graph) => storage.getGraphNodes(graph.id))),
        Promise.all(graphs.map((graph) => storage.getGraphEdges(graph.id)))
    ]);

    const docMap = new Map();
    const edgeMap = new Map();

    graphs.forEach((graph, graphIndex) => {
        const graphNodes = allNodes[graphIndex] || [];
        const graphEdges = allEdges[graphIndex] || [];
        const nodeIdToDocId = new Map();

        graphNodes.forEach((node) => {
            nodeIdToDocId.set(node.id, node.docId);
            if (!node.docId) return;

            if (!docMap.has(node.docId)) {
                docMap.set(node.docId, {
                    id: node.docId,
                    title: node.title || node.docId,
                    occurrences: []
                });
            }

            const entry = docMap.get(node.docId);
            if (!entry.title && node.title) {
                entry.title = node.title;
            }
            entry.occurrences.push({
                graphId: graph.id,
                graphName: graph.name || '未命名图谱',
                nodeId: node.id
            });
        });

        graphEdges.forEach((edge) => {
            const sourceDocId = nodeIdToDocId.get(edge.sourceNodeId);
            const targetDocId = nodeIdToDocId.get(edge.targetNodeId);
            if (!sourceDocId || !targetDocId) return;

            const key = `${sourceDocId}__${targetDocId}`;
            if (!edgeMap.has(key)) {
                edgeMap.set(key, {
                    id: key,
                    source: sourceDocId,
                    target: targetDocId
                });
            }
        });
    });

    globalOverviewIndex = new Map(docMap);
    return {
        nodes: Array.from(docMap.values()).map((entry) => ({
            id: entry.id,
            title: entry.title || entry.id,
            label: '',
            size: 10
        })),
        edges: Array.from(edgeMap.values())
    };
}

async function renderGlobalOverview() {
    const empty = $('#graph-global-overview-empty');
    const container = $('#graph-global-overview');
    if (!empty || !container) return;

    const hasNodes = globalOverviewSnapshot.nodes.length > 0;
    empty.style.display = hasNodes ? 'none' : 'block';
    container.style.display = hasNodes ? 'block' : 'none';

    if (!hasNodes) {
        if (overviewGraphInstance) {
            overviewGraphInstance.changeData({ nodes: [], edges: [] });
            overviewGraphInstance.render();
        }
        return;
    }

    await ensureOverviewGraphInstance();
    if (!overviewGraphInstance) return;

    overviewGraphInstance.changeData(globalOverviewSnapshot);
    overviewGraphInstance.render();
    selectedOverviewDocId = null;
}

function selectOverviewNode(docId) {
    selectedOverviewDocId = docId;
    if (!overviewGraphInstance) return;
    globalOverviewSnapshot.nodes.forEach((node) => {
        const item = overviewGraphInstance.findById(node.id);
        if (!item) return;
        const active = node.id === docId;
        overviewGraphInstance.setItemState(item, 'selected', active);
        updateOverviewNodeLabel(node.id, false);
    });
}

function clearOverviewSelection() {
    selectedOverviewDocId = null;
    if (!overviewGraphInstance) return;
    globalOverviewSnapshot.nodes.forEach((node) => {
        const item = overviewGraphInstance.findById(node.id);
        if (!item) return;
        overviewGraphInstance.setItemState(item, 'selected', false);
        updateOverviewNodeLabel(node.id, false);
    });
}

function updateOverviewNodeLabel(docId, visible) {
    if (!overviewGraphInstance) return;
    const item = overviewGraphInstance.findById(docId);
    const node = globalOverviewSnapshot.nodes.find((entry) => entry.id === docId);
    if (!item || !node) return;
    overviewGraphInstance.updateItem(item, {
        label: visible ? truncateText(node.title || docId, 44) : ''
    });
}

async function handleOverviewNodeOpen(docId) {
    const entry = globalOverviewIndex.get(docId);
    if (!entry || !entry.occurrences?.length) return;

    if (entry.occurrences.length === 1) {
        await jumpToOverviewOccurrence(entry.occurrences[0]);
        return;
    }

    openOverviewJumpModal(entry.occurrences);
}

function openOverviewJumpModal(occurrences) {
    const modal = $('#graph-overview-jump-modal');
    const container = $('#graph-overview-jump-list');
    if (!modal || !container) return;

    container.innerHTML = '';
    occurrences.forEach((occurrence) => {
        const button = createElement('button', {
            type: 'button',
            className: 'graph-overview-jump-item'
        }, [
            createElement('div', { className: 'graph-directory-name', textContent: occurrence.graphName }),
            createElement('div', { className: 'graph-directory-meta', textContent: '打开图谱并定位到该文献节点' })
        ]);
        button.addEventListener('click', async () => {
            closeOverviewJumpModal();
            await jumpToOverviewOccurrence(occurrence);
        });
        container.appendChild(button);
    });

    modal.style.display = 'flex';
}

async function jumpToOverviewOccurrence(occurrence) {
    await openGraphById(occurrence.graphId);
    focusNodeInGraph(occurrence.nodeId);
    selectNode(occurrence.nodeId);
}

function focusNodeInGraph(nodeId) {
    const item = graphInstance?.findById(nodeId);
    if (!item || typeof graphInstance.focusItem !== 'function') return;
    requestAnimationFrame(() => {
        graphInstance.focusItem(item, true, {
            easing: 'easeCubic',
            duration: 500
        });
    });
}

function syncGraphToolbarState() {
    const enabled = !!currentGraph;
    $('#btn-rename-graph').disabled = !enabled;
    $('#btn-graph-auto-layout').disabled = !enabled;
    $('#btn-delete-graph').disabled = !enabled;
}

function showNodeAnchors(nodeId) {
    const item = graphInstance?.findById(nodeId);
    if (!item) return;
    graphInstance.updateItem(item, {
        linkPoints: {
            top: true,
            right: true,
            bottom: true,
            left: true,
            size: 8,
            fill: '#f8fafc',
            stroke: '#60a5fa',
            lineWidth: 2
        }
    });
    refreshNodeAnchorShapes(nodeId);
}

function hideNodeAnchorsIfNeeded(nodeId) {
    if (!graphInstance) return;
    if (dragSession?.sourceNodeId === nodeId) return;
    if (activeTargetAnchor?.nodeId === nodeId) return;
    const item = graphInstance.findById(nodeId);
    if (!item) return;
    graphInstance.updateItem(item, {
        linkPoints: {
            top: false,
            right: false,
            bottom: false,
            left: false,
            size: 8,
            fill: '#f8fafc',
            stroke: '#60a5fa',
            lineWidth: 2
        }
    });
}

function hideAllNodeAnchors() {
    graphSnapshot.nodes.forEach((node) => {
        hideNodeAnchorsIfNeeded(node.id);
        const item = graphInstance?.findById(node.id);
        if (item) graphInstance.setItemState(item, 'active', false);
    });
}

function refreshSelectedNodeAnchors() {
    if (dragSession?.sourceNodeId) showNodeAnchors(dragSession.sourceNodeId);
    if (hoveredNodeId) showNodeAnchors(hoveredNodeId);
    if (activeTargetAnchor?.nodeId) showNodeAnchors(activeTargetAnchor.nodeId);
    applyAnchorHighlights();
}

function applyAnchorHighlights() {
    graphSnapshot.nodes.forEach((node) => {
        refreshNodeAnchorShapes(node.id);
    });
}

function refreshNodeAnchorShapes(nodeId) {
    const item = graphInstance?.findById(nodeId);
    if (!item) return;
    const group = item.getContainer();
    ANCHOR_NAMES.forEach((anchorName, index) => {
        const shape = group.find((element) => element.get('name') === `link-point-${anchorName}`);
        if (!shape) return;
        const isSource = dragSession?.sourceNodeId === nodeId && dragSession?.sourceAnchor === index;
        const isTarget = activeTargetAnchor?.nodeId === nodeId && activeTargetAnchor?.anchorIndex === index;
        shape.attr({
            fill: isSource ? '#60a5fa' : (isTarget ? '#f59e0b' : '#f8fafc'),
            stroke: isSource ? '#bfdbfe' : (isTarget ? '#fde68a' : '#60a5fa'),
            r: isSource || isTarget ? 5.5 : 4.5,
            lineWidth: isSource || isTarget ? 2.4 : 2
        });
    });
}

function getAnchorIndexFromTarget(target) {
    if (!target || !target.get) return -1;
    if (!target.get('isAnchorPoint')) return -1;
    const name = String(target.get('name') || '');
    const anchorName = ANCHOR_NAMES.find((value) => name.endsWith(value));
    return anchorName ? ANCHOR_NAMES.indexOf(anchorName) : -1;
}

function startAnchorDrag({ mode, sourceNodeId, sourceAnchor, edgeId = null, originEvent = null }) {
    clearDragSession();
    dragSession = {
        kind: mode,
        edgeId,
        sourceNodeId,
        sourceAnchor,
        currentPoint: getEventGraphPoint(originEvent) || getAnchorPointByIndex(sourceNodeId, sourceAnchor)
    };

    showNodeAnchors(sourceNodeId);
    refreshSelectedNodeAnchors();
    renderEdgeOverlay();

    document.addEventListener('mousemove', handleDocumentPointerMove);
    document.addEventListener('mouseup', handleDocumentPointerUp);
}

function clearDragSession() {
    dragSession = null;
    activeTargetAnchor = null;
    document.removeEventListener('mousemove', handleDocumentPointerMove);
    document.removeEventListener('mouseup', handleDocumentPointerUp);
    hideAllNodeAnchors();
    if (hoveredNodeId) {
        showNodeAnchors(hoveredNodeId);
        const hoveredItem = graphInstance?.findById(hoveredNodeId);
        if (hoveredItem) graphInstance.setItemState(hoveredItem, 'active', true);
    }
    renderEdgeOverlay();
}

function handleDocumentPointerMove(event) {
    if (!dragSession || !graphInstance) return;
    dragSession.currentPoint = graphInstance.getPointByClient(event.clientX, event.clientY);

    if (dragSession.kind === 'bend') {
        updateBendDrag(dragSession.currentPoint);
        return;
    }

    activeTargetAnchor = findClosestAnchor(dragSession.currentPoint, dragSession);
    updateVisibleAnchorsForDrag();
    renderEdgeOverlay();
}

async function handleDocumentPointerUp() {
    if (!dragSession) return;

    if (dragSession.kind === 'bend') {
        await finalizeBendDrag();
        clearDragSession();
        return;
    }

    const hover = activeTargetAnchor;
    const session = dragSession;
    clearDragSession();

    if (!hover) {
        renderEdgeOverlay();
        return;
    }

    if (session.kind === 'create') {
        await finalizeCreateEdge(session, hover);
        return;
    }

    if (session.kind === 'reconnect-source' || session.kind === 'reconnect-target') {
        await finalizeReconnectEdge(session, hover);
    }
}

function updateVisibleAnchorsForDrag() {
    graphSnapshot.nodes.forEach((node) => {
        const shouldShow = node.id === dragSession?.sourceNodeId || node.id === hoveredNodeId || node.id === activeTargetAnchor?.nodeId;
        if (shouldShow) {
            showNodeAnchors(node.id);
            const item = graphInstance?.findById(node.id);
            if (item) graphInstance.setItemState(item, 'active', true);
        } else {
            const item = graphInstance?.findById(node.id);
            if (item) graphInstance.setItemState(item, 'active', false);
            hideNodeAnchorsIfNeeded(node.id);
        }
    });
    applyAnchorHighlights();
}

async function finalizeCreateEdge(session, hover) {
    const error = validateEdgeConnection(session.sourceNodeId, hover.nodeId, null);
    if (error) {
        alert(error);
        return;
    }

    const startPoint = getAnchorPointByIndex(session.sourceNodeId, session.sourceAnchor);
    const endPoint = getAnchorPointByIndex(hover.nodeId, hover.anchorIndex);
    const controlPoints = computeOrthogonalControlPoints(
        startPoint,
        endPoint,
        session.sourceAnchor,
        hover.anchorIndex,
        session.sourceNodeId,
        hover.nodeId
    );

    const edge = await storage.addGraphEdge({
        graphId: currentGraphId,
        sourceNodeId: session.sourceNodeId,
        targetNodeId: hover.nodeId,
        sourceAnchor: session.sourceAnchor,
        targetAnchor: hover.anchorIndex,
        controlPoints,
        manualRouting: false,
        label: '',
        details: ''
    });

    await reloadCurrentGraph();
    selectEdge(edge.id);
}

async function finalizeReconnectEdge(session, hover) {
    const edge = graphSnapshot.edges.find((item) => item.id === session.edgeId);
    if (!edge) return;

    const nextEdge = { ...edge };
    if (session.kind === 'reconnect-source') {
        nextEdge.sourceNodeId = hover.nodeId;
        nextEdge.sourceAnchor = hover.anchorIndex;
    } else {
        nextEdge.targetNodeId = hover.nodeId;
        nextEdge.targetAnchor = hover.anchorIndex;
    }

    const error = validateEdgeConnection(nextEdge.sourceNodeId, nextEdge.targetNodeId, edge.id);
    if (error) {
        alert(error);
        return;
    }

    const refreshed = refreshEdgeRoute(nextEdge, false);
    await storage.updateGraphEdge(refreshed);
    await reloadCurrentGraph();
    selectEdge(refreshed.id);
}

function startEndpointReconnect(edgeId, endType) {
    const edge = graphSnapshot.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    startAnchorDrag({
        mode: endType === 'source' ? 'reconnect-source' : 'reconnect-target',
        edgeId,
        sourceNodeId: endType === 'source' ? edge.sourceNodeId : edge.targetNodeId,
        sourceAnchor: endType === 'source' ? edge.sourceAnchor : edge.targetAnchor
    });
}

function startBendDrag(edgeId, pointIndex) {
    const edge = graphSnapshot.edges.find((item) => item.id === edgeId);
    if (!edge || !Array.isArray(edge.controlPoints) || edge.controlPoints.length < 2) return;
    dragSession = {
        kind: 'bend',
        edgeId,
        pointIndex
    };
    document.addEventListener('mousemove', handleDocumentPointerMove);
    document.addEventListener('mouseup', handleDocumentPointerUp);
}

function updateBendDrag(currentPoint) {
    const edge = graphSnapshot.edges.find((item) => item.id === dragSession?.edgeId);
    if (!edge || !Array.isArray(edge.controlPoints) || edge.controlPoints.length < 2) return;

    const nextControlPoints = edge.controlPoints.map(clonePoint);
    const sameX = Math.abs(nextControlPoints[0].x - nextControlPoints[1].x) < 0.001;
    if (sameX) {
        nextControlPoints[0].x = currentPoint.x;
        nextControlPoints[1].x = currentPoint.x;
    } else {
        nextControlPoints[0].y = currentPoint.y;
        nextControlPoints[1].y = currentPoint.y;
    }

    edge.controlPoints = nextControlPoints;
    edge.manualRouting = true;
    updateGraphEdgeVisual(edge);
    renderEdgeOverlay();
}

async function finalizeBendDrag() {
    const edge = graphSnapshot.edges.find((item) => item.id === dragSession?.edgeId);
    if (!edge) return;
    edge.manualRouting = true;
    await storage.updateGraphEdge(edge);
    await refreshGraphList();
    renderEdgeOverlay();
}

function validateEdgeConnection(sourceNodeId, targetNodeId, ignoreEdgeId = null) {
    if (!sourceNodeId || !targetNodeId) return '连线端点无效';
    if (sourceNodeId === targetNodeId) return '不允许创建自环连线';

    const duplicate = graphSnapshot.edges.some((edge) => {
        if (ignoreEdgeId && edge.id === ignoreEdgeId) return false;
        return edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId;
    });
    if (duplicate) return '这两篇文献之间已经存在一条连线';

    if (wouldCreateCycle(sourceNodeId, targetNodeId, ignoreEdgeId)) {
        return '该连线会形成环，图谱必须保持有向无环';
    }
    return '';
}

function wouldCreateCycle(sourceNodeId, targetNodeId, ignoreEdgeId = null) {
    const adjacency = new Map();
    graphSnapshot.nodes.forEach((node) => adjacency.set(node.id, []));
    graphSnapshot.edges.forEach((edge) => {
        if (ignoreEdgeId && edge.id === ignoreEdgeId) return;
        if (!adjacency.has(edge.sourceNodeId)) adjacency.set(edge.sourceNodeId, []);
        adjacency.get(edge.sourceNodeId).push(edge.targetNodeId);
    });
    if (!adjacency.has(sourceNodeId)) adjacency.set(sourceNodeId, []);
    adjacency.get(sourceNodeId).push(targetNodeId);

    const queue = [targetNodeId];
    const visited = new Set();
    while (queue.length) {
        const current = queue.shift();
        if (current === sourceNodeId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        (adjacency.get(current) || []).forEach((nextId) => {
            if (!visited.has(nextId)) queue.push(nextId);
        });
    }
    return false;
}

function findClosestAnchor(point, session) {
    let best = null;
    graphSnapshot.nodes.forEach((node) => {
        if (session.kind === 'create' && node.id === session.sourceNodeId) return;
        const item = graphInstance.findById(node.id);
        if (!item) return;
        const bbox = item.getBBox();
        if (!bbox) return;

        const expanded = 28;
        const insideNodeArea = point.x >= bbox.minX - expanded
            && point.x <= bbox.maxX + expanded
            && point.y >= bbox.minY - expanded
            && point.y <= bbox.maxY + expanded;
        if (!insideNodeArea) return;

        for (let anchorIndex = 0; anchorIndex < 4; anchorIndex += 1) {
            const anchorPoint = getAnchorPointByIndex(node.id, anchorIndex);
            if (!anchorPoint) continue;
            const anchorCanvas = graphInstance.getCanvasByPoint(anchorPoint.x, anchorPoint.y);
            const pointerCanvas = graphInstance.getCanvasByPoint(point.x, point.y);
            const distance = Math.hypot(anchorCanvas.x - pointerCanvas.x, anchorCanvas.y - pointerCanvas.y);
            if (distance > ANCHOR_THRESHOLD_PX) continue;

            const candidate = { nodeId: node.id, anchorIndex, distance };
            if (!best || candidate.distance < best.distance) {
                best = candidate;
            }
        }
    });
    return best ? { nodeId: best.nodeId, anchorIndex: best.anchorIndex } : null;
}

function getEventGraphPoint(event) {
    if (!event || !graphInstance) return null;
    if (typeof event.x === 'number' && typeof event.y === 'number') {
        return { x: event.x, y: event.y };
    }
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        return graphInstance.getPointByClient(event.clientX, event.clientY);
    }
    return null;
}

function getAnchorPointByIndex(nodeId, anchorIndex) {
    const item = graphInstance?.findById(nodeId);
    if (!item || typeof item.getLinkPointByAnchor !== 'function') return null;
    const point = item.getLinkPointByAnchor(anchorIndex);
    return point ? { x: point.x, y: point.y } : null;
}

function getGraphAnchorPointFromNode(node, anchorIndex) {
    if (!node) return null;
    const halfWidth = DEFAULT_NODE_SIZE[0] / 2;
    const halfHeight = DEFAULT_NODE_SIZE[1] / 2;
    switch (anchorIndex) {
        case 0: return { x: node.x, y: node.y - halfHeight - ARROW_OFFSET };
        case 1: return { x: node.x + halfWidth + ARROW_OFFSET, y: node.y };
        case 2: return { x: node.x, y: node.y + halfHeight + ARROW_OFFSET };
        default: return { x: node.x - halfWidth - ARROW_OFFSET, y: node.y };
    }
}

function inferNodeAnchorFromDirection(sourceNode, targetNode) {
    if (!sourceNode || !targetNode) return 1;
    const dx = targetNode.x - sourceNode.x;
    const dy = targetNode.y - sourceNode.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    // Prefer horizontal connections when dx is significant relative to node width
    if (absDx > DEFAULT_NODE_SIZE[0] * 0.3 || absDx >= absDy) {
        return dx >= 0 ? 1 : 3;
    }
    return dy >= 0 ? 2 : 0;
}

function inferAnchorFacingPoint(startPoint, endPoint) {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 3 : 1;
    return dy >= 0 ? 0 : 2;
}

function computeOrthogonalControlPoints(startPoint, endPoint, sourceAnchor, targetAnchor, sourceNodeId = null, targetNodeId = null) {
    if (!startPoint || !endPoint) return [];
    const sourceBounds = getExpandedNodeBounds(sourceNodeId, EDGE_CLEARANCE);
    const targetBounds = getExpandedNodeBounds(targetNodeId, EDGE_CLEARANCE);
    const terminalStub = EDGE_STUB + EDGE_ENDPOINT_BUFFER;
    const startStub = offsetPointByAnchor(startPoint, sourceAnchor, terminalStub);
    const endStub = offsetPointByAnchor(endPoint, targetAnchor, terminalStub);
    const candidates = buildOrthogonalRouteCandidates(
        startStub,
        endStub,
        sourceAnchor,
        targetAnchor,
        sourceBounds,
        targetBounds
    );
    const bestRoute = chooseBestOrthogonalRoute(candidates, sourceBounds, targetBounds);
    return bestRoute ?? compressOrthogonalPoints([startStub, endStub]);
}

function buildOrthogonalRouteCandidates(startStub, endStub, sourceAnchor, targetAnchor, sourceBounds, targetBounds) {
    const candidates = [];
    const pushCandidate = (points) => {
        const normalized = compressOrthogonalPoints(points);
        if (!normalized.length) return;
        const signature = normalized.map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`).join('|');
        if (!candidates.some((candidate) => candidate.signature === signature)) {
            candidates.push({ signature, points: normalized });
        }
    };

    pushCandidate(buildBasicOrthogonalCandidate(startStub, endStub, sourceAnchor, targetAnchor));

    const leftX = Math.min(sourceBounds?.left ?? startStub.x, targetBounds?.left ?? endStub.x, startStub.x, endStub.x) - EDGE_STUB;
    const rightX = Math.max(sourceBounds?.right ?? startStub.x, targetBounds?.right ?? endStub.x, startStub.x, endStub.x) + EDGE_STUB;
    const topY = Math.min(sourceBounds?.top ?? startStub.y, targetBounds?.top ?? endStub.y, startStub.y, endStub.y) - EDGE_STUB;
    const bottomY = Math.max(sourceBounds?.bottom ?? startStub.y, targetBounds?.bottom ?? endStub.y, startStub.y, endStub.y) + EDGE_STUB;

    pushCandidate([startStub, { x: leftX, y: startStub.y }, { x: leftX, y: endStub.y }, endStub]);
    pushCandidate([startStub, { x: rightX, y: startStub.y }, { x: rightX, y: endStub.y }, endStub]);
    pushCandidate([startStub, { x: startStub.x, y: topY }, { x: endStub.x, y: topY }, endStub]);
    pushCandidate([startStub, { x: startStub.x, y: bottomY }, { x: endStub.x, y: bottomY }, endStub]);

    return candidates;
}

function buildBasicOrthogonalCandidate(startStub, endStub, sourceAnchor, targetAnchor) {
    const sourceHorizontal = sourceAnchor === 1 || sourceAnchor === 3;
    const targetHorizontal = targetAnchor === 1 || targetAnchor === 3;

    if (sourceHorizontal && targetHorizontal) {
        let midX = (startStub.x + endStub.x) / 2;
        if (sourceAnchor === 1 && targetAnchor === 1) {
            midX = Math.max(startStub.x, endStub.x) + EDGE_STUB;
        } else if (sourceAnchor === 3 && targetAnchor === 3) {
            midX = Math.min(startStub.x, endStub.x) - EDGE_STUB;
        }
        return [
            startStub,
            { x: midX, y: startStub.y },
            { x: midX, y: endStub.y },
            endStub
        ];
    }

    if (!sourceHorizontal && !targetHorizontal) {
        let midY = (startStub.y + endStub.y) / 2;
        if (sourceAnchor === 2 && targetAnchor === 2) {
            midY = Math.max(startStub.y, endStub.y) + EDGE_STUB;
        } else if (sourceAnchor === 0 && targetAnchor === 0) {
            midY = Math.min(startStub.y, endStub.y) - EDGE_STUB;
        }
        return [
            startStub,
            { x: startStub.x, y: midY },
            { x: endStub.x, y: midY },
            endStub
        ];
    }

    if (sourceHorizontal) {
        return [
            startStub,
            { x: endStub.x, y: startStub.y },
            endStub
        ];
    }

    return [
        startStub,
        { x: startStub.x, y: endStub.y },
        endStub
    ];
}

function chooseBestOrthogonalRoute(candidates, sourceBounds, targetBounds) {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    const scored = candidates.map((candidate) => ({
        points: candidate.points,
        intersects: routeIntersectsBounds(candidate.points, sourceBounds) || routeIntersectsBounds(candidate.points, targetBounds),
        turns: countOrthogonalTurns(candidate.points),
        length: getPolylineLength(candidate.points)
    }));

    const valid = scored.filter((candidate) => !candidate.intersects);
    const pool = valid.length ? valid : scored;
    // Score: penalize turns heavily but also factor in path length
    pool.sort((left, right) => {
        const turnWeight = 200;
        const scoreLeft = left.turns * turnWeight + left.length;
        const scoreRight = right.turns * turnWeight + right.length;
        return scoreLeft - scoreRight;
    });
    return pool[0]?.points ?? null;
}

function getExpandedNodeBounds(nodeId, padding = 0) {
    if (!nodeId) return null;
    const node = graphSnapshot.nodes.find((entry) => entry.id === nodeId);
    if (!node) return null;
    const halfWidth = DEFAULT_NODE_SIZE[0] / 2;
    const halfHeight = DEFAULT_NODE_SIZE[1] / 2;
    return {
        left: node.x - halfWidth - padding,
        right: node.x + halfWidth + padding,
        top: node.y - halfHeight - padding,
        bottom: node.y + halfHeight + padding
    };
}

function routeIntersectsBounds(points, bounds) {
    if (!bounds || !Array.isArray(points) || points.length < 2) return false;
    for (let index = 0; index < points.length - 1; index += 1) {
        if (segmentIntersectsBounds(points[index], points[index + 1], bounds)) {
            return true;
        }
    }
    return false;
}

function segmentIntersectsBounds(startPoint, endPoint, bounds) {
    if (!startPoint || !endPoint || !bounds) return false;

    if (Math.abs(startPoint.x - endPoint.x) < 0.001) {
        const x = startPoint.x;
        if (x < bounds.left || x > bounds.right) return false;
        const minY = Math.min(startPoint.y, endPoint.y);
        const maxY = Math.max(startPoint.y, endPoint.y);
        return maxY >= bounds.top && minY <= bounds.bottom;
    }

    if (Math.abs(startPoint.y - endPoint.y) < 0.001) {
        const y = startPoint.y;
        if (y < bounds.top || y > bounds.bottom) return false;
        const minX = Math.min(startPoint.x, endPoint.x);
        const maxX = Math.max(startPoint.x, endPoint.x);
        return maxX >= bounds.left && minX <= bounds.right;
    }

    return false;
}

function countOrthogonalTurns(points) {
    if (!Array.isArray(points) || points.length < 3) return 0;
    let turns = 0;
    let previousDirection = null;

    for (let index = 0; index < points.length - 1; index += 1) {
        const startPoint = points[index];
        const endPoint = points[index + 1];
        const direction = Math.abs(startPoint.x - endPoint.x) < 0.001 ? 'v' : 'h';
        if (previousDirection && direction !== previousDirection) {
            turns += 1;
        }
        previousDirection = direction;
    }

    return turns;
}

function getPolylineLength(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let total = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
        total += Math.abs(points[index].x - points[index + 1].x) + Math.abs(points[index].y - points[index + 1].y);
    }
    return total;
}

function offsetPointByAnchor(point, anchorIndex, distance) {
    if (!point) return null;
    switch (anchorIndex) {
        case 0:
            return { x: point.x, y: point.y - distance };
        case 1:
            return { x: point.x + distance, y: point.y };
        case 2:
            return { x: point.x, y: point.y + distance };
        default:
            return { x: point.x - distance, y: point.y };
    }
}

function compressOrthogonalPoints(points) {
    if (!Array.isArray(points) || !points.length) return [];

    const normalized = [];
    points.forEach((point) => {
        if (!point) return;
        const last = normalized[normalized.length - 1];
        if (!last || Math.abs(last.x - point.x) > 0.001 || Math.abs(last.y - point.y) > 0.001) {
            normalized.push(clonePoint(point));
        }
    });

    if (normalized.length <= 2) {
        return normalized;
    }

    const compressed = [normalized[0]];
    for (let index = 1; index < normalized.length - 1; index += 1) {
        const prev = compressed[compressed.length - 1];
        const current = normalized[index];
        const next = normalized[index + 1];
        const sameX = Math.abs(prev.x - current.x) < 0.001 && Math.abs(current.x - next.x) < 0.001;
        const sameY = Math.abs(prev.y - current.y) < 0.001 && Math.abs(current.y - next.y) < 0.001;
        if (!sameX && !sameY) {
            compressed.push(current);
        }
    }
    compressed.push(normalized[normalized.length - 1]);
    return compressed;
}

function refreshEdgeRoute(edge, keepManualRouting = true) {
    const startPoint = getAnchorPointByIndex(edge.sourceNodeId, edge.sourceAnchor);
    const endPoint = getAnchorPointByIndex(edge.targetNodeId, edge.targetAnchor);
    if (!startPoint || !endPoint) return edge;

    if (!keepManualRouting || !edge.manualRouting || !Array.isArray(edge.controlPoints) || edge.controlPoints.length < 2) {
        edge.controlPoints = computeOrthogonalControlPoints(
            startPoint,
            endPoint,
            edge.sourceAnchor,
            edge.targetAnchor,
            edge.sourceNodeId,
            edge.targetNodeId
        );
        edge.manualRouting = false;
        return edge;
    }

    const controlPoints = edge.controlPoints.map(clonePoint);
    const sameX = Math.abs(controlPoints[0].x - controlPoints[1].x) < 0.001;
    if (sameX) {
        const lockedX = controlPoints[0].x;
        edge.controlPoints = [{ x: lockedX, y: startPoint.y }, { x: lockedX, y: endPoint.y }];
    } else {
        const lockedY = controlPoints[0].y;
        edge.controlPoints = [{ x: startPoint.x, y: lockedY }, { x: endPoint.x, y: lockedY }];
    }
    edge.manualRouting = true;
    return edge;
}

async function refreshConnectedEdgesForNode(nodeId) {
    const connected = graphSnapshot.edges.filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId);
    for (const edge of connected) {
        refreshEdgeRoute(edge, true);
        updateGraphEdgeVisual(edge);
        await storage.updateGraphEdge(edge);
    }
}

function renderEdgeOverlay() {
    if (!overlayPreviewGroup || !overlayHandlesGroup || !graphInstance) return;
    overlayPreviewGroup.innerHTML = '';
    overlayHandlesGroup.innerHTML = '';

    if (dragSession && dragSession.kind !== 'bend') {
        renderPreviewPath();
    }

    if (selectedItem.type === 'edge' && selectedItem.id && !dragSession) {
        renderSelectedEdgeHandles(selectedItem.id);
    }
}

function renderPreviewPath() {
    const previewRoute = getPreviewRoute();
    if (!previewRoute) return;
    const points = previewRoute.map(toCanvasPoint).map((point) => `${point.x},${point.y}`).join(' ');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    polyline.setAttribute('class', 'graph-preview-path');
    overlayPreviewGroup.appendChild(polyline);
}

function getPreviewRoute() {
    if (!dragSession) return null;

    if (dragSession.kind === 'create') {
        const startPoint = getAnchorPointByIndex(dragSession.sourceNodeId, dragSession.sourceAnchor);
        const endPoint = activeTargetAnchor
            ? getAnchorPointByIndex(activeTargetAnchor.nodeId, activeTargetAnchor.anchorIndex)
            : dragSession.currentPoint;
        const targetAnchor = activeTargetAnchor
            ? activeTargetAnchor.anchorIndex
            : inferAnchorFacingPoint(startPoint, endPoint);
        const controlPoints = computeOrthogonalControlPoints(
            startPoint,
            endPoint,
            dragSession.sourceAnchor,
            targetAnchor,
            dragSession.sourceNodeId,
            activeTargetAnchor?.nodeId ?? null
        );
        return [startPoint, ...controlPoints, endPoint];
    }

    const edge = graphSnapshot.edges.find((item) => item.id === dragSession.edgeId);
    if (!edge) return null;

    if (dragSession.kind === 'reconnect-source') {
        const endPoint = getAnchorPointByIndex(edge.targetNodeId, edge.targetAnchor);
        const startPoint = activeTargetAnchor
            ? getAnchorPointByIndex(activeTargetAnchor.nodeId, activeTargetAnchor.anchorIndex)
            : dragSession.currentPoint;
        const sourceAnchor = activeTargetAnchor
            ? activeTargetAnchor.anchorIndex
            : inferNodeAnchorFromDirection({ x: startPoint.x, y: startPoint.y }, { x: endPoint.x, y: endPoint.y });
        const controlPoints = computeOrthogonalControlPoints(
            startPoint,
            endPoint,
            sourceAnchor,
            edge.targetAnchor,
            activeTargetAnchor?.nodeId ?? null,
            edge.targetNodeId
        );
        return [startPoint, ...controlPoints, endPoint];
    }

    if (dragSession.kind === 'reconnect-target') {
        const startPoint = getAnchorPointByIndex(edge.sourceNodeId, edge.sourceAnchor);
        const endPoint = activeTargetAnchor
            ? getAnchorPointByIndex(activeTargetAnchor.nodeId, activeTargetAnchor.anchorIndex)
            : dragSession.currentPoint;
        const targetAnchor = activeTargetAnchor
            ? activeTargetAnchor.anchorIndex
            : inferAnchorFacingPoint(startPoint, endPoint);
        const controlPoints = computeOrthogonalControlPoints(
            startPoint,
            endPoint,
            edge.sourceAnchor,
            targetAnchor,
            edge.sourceNodeId,
            activeTargetAnchor?.nodeId ?? null
        );
        return [startPoint, ...controlPoints, endPoint];
    }

    return null;
}

function renderSelectedEdgeHandles(edgeId) {
    const edge = graphSnapshot.edges.find((item) => item.id === edgeId);
    if (!edge) return;
    const editableControlPoints = Array.isArray(edge.controlPoints) && edge.controlPoints.length
        ? edge.controlPoints
        : computeOrthogonalControlPoints(
            getAnchorPointByIndex(edge.sourceNodeId, edge.sourceAnchor),
            getAnchorPointByIndex(edge.targetNodeId, edge.targetAnchor),
            edge.sourceAnchor,
            edge.targetAnchor,
            edge.sourceNodeId,
            edge.targetNodeId
        );

    const startPoint = getAnchorPointByIndex(edge.sourceNodeId, edge.sourceAnchor);
    const endPoint = getAnchorPointByIndex(edge.targetNodeId, edge.targetAnchor);
    if (!startPoint || !endPoint) return;

    createHandleCircle(startPoint, 'graph-endpoint-handle', () => startEndpointReconnect(edge.id, 'source'));
    createHandleCircle(endPoint, 'graph-endpoint-handle', () => startEndpointReconnect(edge.id, 'target'));

    editableControlPoints.forEach((point, index) => {
        createHandleCircle(point, 'graph-bend-handle', () => startBendDrag(edge.id, index));
    });
}

function createHandleCircle(graphPoint, className, onMouseDown) {
    const point = toCanvasPoint(graphPoint);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(point.x));
    circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', className === 'graph-endpoint-handle' ? '7' : '6');
    circle.setAttribute('class', className);
    circle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onMouseDown(event);
    });
    overlayHandlesGroup.appendChild(circle);
}

function toCanvasPoint(graphPoint) {
    const point = graphInstance.getCanvasByPoint(graphPoint.x, graphPoint.y);
    return { x: point.x, y: point.y };
}

function clonePoint(point) {
    return { x: point.x, y: point.y };
}

function formatGraphMeta(graph) {
    const date = new Date(graph.updatedAt || graph.createdAt || Date.now());
    return `最近更新 ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
