# ScholarMark 学术演进图谱功能分析

**分析时间**：2026-02-28

---

## 一、功能概述

**学术演进图谱**是 ScholarMark 的核心功能之一，旨在帮助研究者可视化地梳理和记录多篇学术文献之间的演进关系。用户可以：

- 创建多张独立的"图谱"（按研究方向组织）
- 将已导入的 PDF 文献添加为图谱中的**节点**
- 通过有向**连线**表达文献间的演进/引用关系
- 在连线上撰写**改进分析笔记**（Markdown）
- 从图谱节点一键跳转回 PDF 阅读界面

---

## 二、技术栈

| 技术 | 说明 |
|------|------|
| **@antv/G6 v4.x** | 基于 Canvas 的图可视化引擎，实现节点/边的渲染、交互 |
| **IndexedDB** | 本地持久化存储图谱数据（3 个 ObjectStore） |
| **原生 JavaScript** | 无框架依赖，与项目整体技术栈一致 |
| **SVG Overlay** | 自定义边端点拖拽和弯折手柄的交互层 |

---

## 三、文件结构

```
涉及文件：
├── src/modules/graph-workspace.js   # 核心逻辑（1749 行，88 个函数）
├── src/modules/storage.js           # 存储层 Graph 部分（741-997 行）
├── src/styles/graph.css             # 样式（333 行）
├── index.html                       # UI 结构（557-665 行）
└── ScholarMark文献流功能实现方案.md  # 原始设计方案文档
```

---

## 四、数据模型

### 4.1 IndexedDB ObjectStore 设计

```
数据库：ScholarMarkDB

┌─────────────────────────────────────────────────────────────┐
│  graphs              │  主键: id                           │
│                      │  索引: updatedAt                    │
│  字段: id, name, createdAt, updatedAt                      │
├─────────────────────────────────────────────────────────────┤
│  graphNodes          │  主键: id                           │
│                      │  索引: graphId, [graphId, docId]    │
│  字段: id, graphId, docId, title, authors, year, x, y,    │
│        createdAt, updatedAt                                │
├─────────────────────────────────────────────────────────────┤
│  graphEdges          │  主键: id                           │
│                      │  索引: graphId,                     │
│                      │  [graphId, sourceNodeId, targetNodeId] │
│  字段: id, graphId, sourceNodeId, targetNodeId,            │
│        sourceAnchor, targetAnchor, controlPoints,          │
│        manualRouting, label, details, createdAt, updatedAt │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 数据关系

```
Graph (图谱)    1 ──── N    GraphNode (文献节点)
Graph (图谱)    1 ──── N    GraphEdge (演进连线)
GraphNode       1 ──── 1    PDF 文献 (通过 docId 关联)
GraphEdge     源节点 ──→ 目标节点 (有向边)
```

---

## 五、核心模块分析

### 5.1 graph-workspace.js（88 个函数）

按功能分为以下几个子系统：

#### A. 初始化与生命周期管理

| 函数 | 说明 |
|------|------|
| `initGraphWorkspace(callbacks)` | 初始化入口，绑定事件、恢复上次打开的图谱 |
| `setCurrentGraphPdfContext(pdfContext)` | 设置当前 PDF 上下文，启用/禁用"加入图谱"按钮 |
| `openGraphWorkspaceView()` | 打开图谱全屏工作台 |
| `closeGraphWorkspaceView()` | 关闭工作台 |
| `bindGraphWorkspaceEvents()` | 绑定所有 UI 按钮和输入框事件 |

#### B. 图谱 CRUD 管理

| 函数 | 说明 |
|------|------|
| `promptCreateGraph()` | 弹窗输入名称，创建新图谱 |
| `openGraphById(graphId)` | 打开指定图谱，加载快照并渲染 |
| `loadGraphSnapshot(graphId)` | 从 DB 加载节点和边数据 |
| `reloadCurrentGraph()` | 重新加载当前图谱 |
| `refreshGraphList()` | 刷新图谱列表和计数 |
| `renderGraphDirectory()` | 渲染左侧图谱目录 |

#### C. 文献节点操作

| 函数 | 说明 |
|------|------|
| `addCurrentPdfToGraph(graphId)` | 将当前打开的 PDF 添加为图谱节点 |
| `openAddToGraphModal()` | 打开"加入图谱"模态框 |
| `renderAddToGraphList()` | 渲染可选图谱列表 |
| `getSuggestedPosition(nodes)` | 智能计算新节点位置（网格布局） |

#### D. G6 图实例管理

| 函数 | 说明 |
|------|------|
| `ensureGraphInstance()` | 创建/确保 G6 Graph 实例（核心配置在此） |
| `renderGraphWorkspace()` | 使用 `changeData()` 渲染当前图谱 |
| `resizeGraphCanvas()` | 画布自适应容器大小 |
| `toG6NodeModel(node)` | 将存储节点转为 G6 节点模型 |
| `toG6EdgeModel(edge)` | 将存储边转为 G6 边模型 |

**G6 配置要点**：

- 节点类型：`rect`（矩形），尺寸 `240×84`，圆角 14
- 边类型：`polyline`（折线），带箭头（三角形）
- 交互模式：`drag-canvas`（拖拽画布）、`zoom-canvas`（滚轮缩放）、`drag-node`（拖拽节点）
- 暗色主题配色：深灰背景 (#1f2937)、浅色文字 (#f8fafc)

#### E. 选中与属性面板

| 函数 | 说明 |
|------|------|
| `selectNode(nodeId)` | 选中节点，填充右侧属性面板 |
| `selectEdge(edgeId)` | 选中边，填充演进关系面板 |
| `clearSelection()` | 清空选中 |
| `setInspectorPanel(type)` | 切换属性面板（empty/node/edge） |
| `renderStats()` | 渲染图谱统计（节点数、连线数、当前文献状态） |

#### F. 边端点拖拽系统（SVG Overlay）

这是最复杂的子系统，实现了自定义的连线创建与编辑交互：

| 函数 | 说明 |
|------|------|
| `ensureOverlay(container)` | 创建 SVG 覆盖层 |
| `showNodeAnchors(nodeId)` | 显示节点四个方向的锚点 |
| `startAnchorDrag({...})` | 开始拖拽创建连线 |
| `handleDocumentPointerMove(event)` | 全局鼠标移动追踪 |
| `handleDocumentPointerUp()` | 完成拖拽，创建/重连边 |
| `findClosestAnchor(point, session)` | 寻找最近的锚点 |
| `finalizeCreateEdge(session, hover)` | 创建新边 |
| `finalizeReconnectEdge(session, hover)` | 重连已有边 |
| `startEndpointReconnect(edgeId, endType)` | 拖拽已有边的端点重连 |
| `startBendDrag(edgeId, pointIndex)` | 拖拽弯折点 |
| `renderEdgeOverlay()` | 渲染边手柄和预览路径 |
| `renderPreviewPath()` | 渲染拖拽中的预览连线 |
| `renderSelectedEdgeHandles(edgeId)` | 渲染选中边的端点和弯折手柄 |

**锚点系统**：

- 每个节点有 4 个方向的锚点：上(0)、右(1)、下(2)、左(3)
- 锚点激活、悬停时有不同颜色高亮
- 源锚点：蓝色 (#60a5fa)
- 目标锚点：橙色 (#f59e0b)

#### G. 正交路由算法

实现了专业的折线路由算法，避免连线穿越节点：

| 函数 | 说明 |
|------|------|
| `computeOrthogonalControlPoints(...)` | 计算正交折线控制点 |
| `buildOrthogonalRouteCandidates(...)` | 生成候选路由 |
| `buildBasicOrthogonalCandidate(...)` | 构建基础正交候选路线 |
| `chooseBestOrthogonalRoute(candidates, ...)` | 选择最优路由（避免穿越节点） |
| `routeIntersectsBounds(points, bounds)` | 检查路线是否与节点边界相交 |
| `segmentIntersectsBounds(...)` | 线段与边界相交检测 |
| `compressOrthogonalPoints(points)` | 压缩冗余折点 |
| `refreshEdgeRoute(edge, keepManualRouting)` | 刷新边的路由 |

#### H. 自动布局

| 函数 | 说明 |
|------|------|
| `autoLayoutCurrentGraph()` | 执行自动布局 |
| `buildAutoLayout(nodes, edges, width, height)` | 基于拓扑排序的层级布局算法 |

**布局算法**：

1. 计算节点入度
2. 拓扑排序分层
3. 按层级从左到右排列
4. 同层内垂直均匀分布

#### I. 环检测

| 函数 | 说明 |
|------|------|
| `validateEdgeConnection(sourceNodeId, targetNodeId, ignoreEdgeId)` | 验证连线合法性（防止自环、重复、成环） |
| `wouldCreateCycle(sourceNodeId, targetNodeId, ignoreEdgeId)` | DFS 环检测 |

---

### 5.2 storage.js — 图谱存储 API

| 函数 | 说明 |
|------|------|
| `createGraph(name)` | 创建新图谱记录 |
| `getAllGraphs()` | 获取所有图谱（按更新时间倒序） |
| `getGraph(graphId)` | 获取单个图谱 |
| `updateGraph(graph)` | 更新图谱（自动更新 updatedAt） |
| `deleteGraph(graphId)` | 删除图谱及其关联的所有节点和边 |
| `getGraphNodes(graphId)` | 获取图谱下所有节点 |
| `getGraphNode(nodeId)` | 获取单个节点 |
| `getGraphNodeByDocId(graphId, docId)` | 按文档 ID 查找节点（防重复添加） |
| `addGraphNode(node)` | 添加节点 |
| `updateGraphNode(node)` | 更新节点 |
| `deleteGraphNode(nodeId)` | 删除节点及关联的边 |
| `getGraphEdges(graphId)` | 获取图谱下所有边 |
| `getGraphEdge(edgeId)` | 获取单个边 |
| `getGraphEdgeByPair(graphId, sourceNodeId, targetNodeId)` | 按源/目标节点对查找边 |
| `addGraphEdge(edge)` | 添加边 |
| `updateGraphEdge(edge)` | 更新边 |
| `deleteGraphEdge(edgeId)` | 删除边 |
| `touchGraphUpdatedAtTx(tx, graphId)` | 事务内更新图谱时间戳 |

**级联删除**：

- 删除图谱 → 级联删除所有节点和边
- 删除节点 → 级联删除关联的边

---

## 六、UI 布局结构

### 6.1 整体布局

图谱工作台是一个全屏覆盖层，固定在应用 header 下方：

```
┌─────────────────────────────────────────────────────────────┐
│  Header: "学术演进图谱" │ N张图谱 │ [新建] │ [关闭]        │
├──────────┬──────────────────────────────────────────────────┤
│          │  工具栏: 图谱名称 │ 统计 │ [重命名][排布][删除] │
│  图谱列表 ├──────────────────────────┬─────────────────────┤
│  ──────  │                          │                     │
│  [图谱1] │     G6 Canvas 画布       │   属性检查器面板     │
│  [图谱2] │   （拖拽平移/滚轮缩放）  │   ────────────      │
│  [图谱3] │                          │  □ 图谱概览/统计    │
│          │   ◯文献A ──→ ◯文献B     │  □ 节点属性编辑     │
│          │       ↓                  │  □ 连线属性编辑     │
│          │   ◯文献C                 │                     │
│          │                          │                     │
└──────────┴──────────────────────────┴─────────────────────┘
```

### 6.2 三种属性面板

1. **图谱概览**（默认）：显示节点数、连线数、当前文献状态
2. **节点面板**：标题、作者、年份编辑 + 返回 PDF 阅读按钮 + 删除
3. **连线面板**：方向说明、标签输入、详细分析（Markdown）+ 删除

### 6.3 入口方式

- **左侧栏"图谱"Tab**：点击打开图谱全屏工作台
- **PDF 工具栏"加入图谱"按钮**：将当前文献添加到图谱

---

## 七、交互流程

### 7.1 创建图谱

```
用户点击"新建图谱" → 弹窗输入名称 → storage.createGraph()
→ 图谱出现在左侧目录 → 自动打开新图谱
```

### 7.2 添加文献到图谱

```
用户打开一篇 PDF → 工具栏出现"加入图谱"按钮 → 点击
→ 弹出模态框列出所有图谱 → 选择目标图谱
→ 检查是否已存在（getGraphNodeByDocId）
→ 智能计算位置（getSuggestedPosition）
→ storage.addGraphNode() → 画布渲染新节点
```

### 7.3 创建演进连线

```
鼠标悬停节点 → 显示四方向锚点
→ 从锚点拖拽到另一节点的锚点
→ 验证连接合法性（防自环、防重复、防成环）
→ 计算正交路由控制点
→ storage.addGraphEdge() → 画布渲染新连线
```

### 7.4 编辑连线详情

```
点击连线 → 右侧面板显示方向信息
→ 输入连线标签（如"引入注意力机制"）
→ 输入详细分析（支持 Markdown）
→ 防抖自动保存（350ms）
```

### 7.5 跳转回 PDF

```
点击节点 → 右侧面板显示节点信息
→ 点击"返回 PDF 阅读" → 关闭图谱工作台
→ 调用 onOpenPdf 回调 → 定位到对应 PDF
```

---

## 八、设计亮点

1. **多图谱管理**：支持按研究方向创建多张独立图谱
2. **智能路由**：正交折线算法自动避让节点，支持手动调整弯折点
3. **环检测**：DFS 算法防止创建循环依赖
4. **拓扑排序布局**：自动按文献演进顺序从左到右分层排列
5. **防抖自动保存**：编辑节点/边属性时 350ms 防抖自动持久化
6. **级联删除**：删除图谱/节点时自动清理关联数据
7. **持久化选中状态**：通过 localStorage 记住上次打开的图谱
8. **SVG 覆盖层**：独立的 SVG 层处理边端点和弯折手柄交互
9. **响应式布局**：CSS 媒体查询适配不同屏幕宽度

---

## 九、与原始方案对比

对比 `ScholarMark文献流功能实现方案.md` 的设计，实际实现有以下增强：

| 特性 | 原始方案 | 实际实现 |
|------|----------|----------|
| 数据存储 | 使用 Settings KV 表 | 独立的 3 个 ObjectStore |
| 图谱数量 | 暗示仅 1 张 | 支持多张图谱管理 |
| 连线创建 | G6 内置 create-edge | 自定义 SVG Overlay 锚点拖拽 |
| 连线路由 | 未提及 | 正交路由 + 弯折点调整 |
| 环检测 | 未提及 | DFS 环检测 |
| 自动布局 | 仅提及"重新排版" | 拓扑排序分层布局算法 |
| 节点属性 | 只读元数据 | 可编辑标题、作者、年份 |
| 边端点管理 | 未提及 | 端点重连 + 弯折点拖拽 |

---

## 十、代码量统计

| 文件 | 行数 | 函数数 | 说明 |
|------|------|--------|------|
| `graph-workspace.js` | 1749 | 88 | 核心逻辑 |
| `storage.js`（Graph 部分） | ~257 | 18 | 存储 API |
| `graph.css` | 333 | — | 样式 |
| `index.html`（Graph 部分） | ~109 | — | UI 结构 |
| **合计** | **~2448** | **106** | |
