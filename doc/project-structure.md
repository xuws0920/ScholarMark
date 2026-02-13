# ScholarMark PDF 文献阅读器 — 项目结构分析

**分析时间**：2026-02-13

---

## 一、项目概述

**ScholarMark** 是一个基于 Web 的 PDF 文献阅读标注工具，核心功能是：

- 📄 PDF 渲染与阅读
- 🎯 文本高亮标注（5种颜色）
- 📝 Markdown 笔记编辑
- 🔗 标注 ↔ 笔记双向跳转
- 🔍 全文搜索
- 📥 笔记导出

**技术栈**：Vite + 原生 JavaScript + IndexedDB + PDF.js + marked + highlight.js

---

## 二、目录结构

```
pdf-reader/
├── index.html              # 应用唯一页面（三栏布局 SPA）
├── package.json            # 依赖配置
├── vite.config.js          # Vite 开发服务器配置
├── doc/
│   └── progress.md         # 开发进展文档
└── src/
    ├── main.js             # 应用入口（模块初始化 + 事件连接）
    ├── modules/            # 核心功能模块
    │   ├── storage.js      # IndexedDB 数据持久化
    │   ├── pdf-viewer.js   # PDF 渲染与浏览
    │   ├── annotator.js    # 文本标注
    │   ├── note-editor.js  # Markdown 笔记编辑
    │   ├── library.js      # 文献库管理
    │   └── search.js       # 搜索
    ├── utils/              # 工具函数
    │   ├── dom.js          # DOM 操作辅助
    │   └── export.js       # 笔记导出
    └── styles/             # CSS 样式
        ├── index.css       # 全局设计系统 + 通用组件
        ├── sidebar.css     # 左侧文献库侧栏样式
        ├── pdf-viewer.css  # PDF 阅读器样式
        └── notes.css       # 笔记面板样式
```

---

## 三、核心模块详解

### 3.1 `main.js` — 应用入口（464 行）

**职责**：初始化所有模块，连接模块间事件，协调整体工作流。

| 功能 | 说明 |
|------|------|
| `init()` | 按顺序初始化 DB → PDF Viewer → 标注 → 笔记 → 文献库 → 搜索 |
| `setupUIEvents()` | 设置弹窗、导出按钮、右键菜单等 UI 事件 |
| `refreshAnnotationsList()` | 在右侧面板中渲染标注列表（按颜色分组、页码排序） |
| `setupResizeHandles()` | 左右侧栏拖拽调整宽度 |
| `initTheme()` / `applyTheme()` | 深色/浅色主题切换，持久化到 localStorage |

**模块间连接**：
- PDF 选中文本 → 显示标注工具栏
- 标注创建 → 插入笔记引用
- 搜索结果点击 → 切换 PDF 并跳转
- 标注右键菜单 → 查看笔记 / 删除标注

---

### 3.2 `storage.js` — 数据持久化（338 行）

**职责**：封装 IndexedDB 的所有 CRUD 操作。

**数据库**：`ScholarMarkDB`，版本 1

| 数据表 | 主键 | 索引 | 存储内容 |
|--------|------|------|----------|
| `pdfs` | `id` | `name`, `addedAt` | PDF 文件数据（ArrayBuffer）、名称、大小、时间戳 |
| `annotations` | `id` | `pdfId`, `page`, `noteId`, `[pdfId, page]` | 标注文本、颜色、坐标矩形、关联笔记 |
| `notes` | `id` | `pdfId` | 笔记标题、Markdown 内容、关联标注 ID 列表 |
| `settings` | `key` | — | 键值对设置项 |

**导出函数**：
- PDF: `addPdf`, `getAllPdfs`, `getPdfData`, `deletePdf`, `updatePdfLastOpened`
- 标注: `addAnnotation`, `getAnnotationsByPdf`, `updateAnnotation`, `deleteAnnotation`, `getAnnotation`
- 笔记: `addNote`, `getNotesByPdf`, `getNote`, `updateNote`, `deleteNote`
- 设置: `getSetting`, `setSetting`
- 搜索: `searchAll` — 全文搜索标注和笔记
- 工具: `generateId`

---

### 3.3 `pdf-viewer.js` — PDF 渲染与浏览（426 行）

**职责**：基于 PDF.js 实现 PDF 加载、渲染、翻页、缩放、文本选取。

**核心机制**：
- 每一页由 `canvas`（PDF 渲染）+ `textLayer`（文本选取）+ `highlightLayer`（标注高亮）三层组成
- 坐标归一化：选中区域的坐标归一化到 `scale=1.0` 存储，渲染时按当前 scale 缩放
- 所有页面一次性渲染（非懒加载）
- 支持设备像素比（DPR）高清渲染

**导出函数**：
| 函数 | 说明 |
|------|------|
| `initPdfViewer(callbacks)` | 初始化，注册页面变化/文本选中/标注点击的回调 |
| `loadPdf(arrayBuffer)` | 加载并渲染 PDF |
| `goToPage(pageNum)` | 跳转到指定页 |
| `setScale(scale)` | 设置缩放比例（0.5 ~ 3.0） |
| `addHighlightToPage(pageNum, annotation)` | 在指定页添加高亮标记 |
| `clearHighlightsOnPage(pageNum)` | 清除单页高亮 |
| `clearAllHighlights()` | 清除所有页高亮 |
| `flashAnnotation(annotationId)` | 标注闪烁高亮效果 |

---

### 3.4 `annotator.js` — 文本标注（189 行）

**职责**：处理文本选中、创建/删除标注、标注↔笔记关联。

**工作流**：
1. 用户在 PDF 中选中文本 → `pdf-viewer` 触发 `onTextSelected`
2. 显示浮动工具栏（5 种颜色按钮 + 插入笔记按钮）
3. 点击颜色按钮 → 创建标注（存储到 DB + 渲染高亮）
4. 点击📝按钮 → 创建标注并插入到笔记

**导出函数**：`initAnnotator`, `setPdfId`, `showToolbar`, `renderAllAnnotations`, `getAnnotations`, `navigateToAnnotation`, `linkAnnotationToNote`, `removeAnnotation`, `handleAnnotationClick`

---

### 3.5 `note-editor.js` — Markdown 笔记编辑器（300 行）

**职责**：Markdown 编辑、预览、笔记 CRUD、标注引用跳转。

**功能特色**：
- 三个 Tab：编辑 / 预览 / 标注列表
- Markdown 渲染使用 `marked` + `highlight.js` 代码高亮
- 自动保存（500ms 防抖）
- 标注引用块可点击跳转到 PDF 对应位置
- 每个 PDF 独立管理多个笔记

**导出函数**：`initNoteEditor`, `setPdfId`, `insertAnnotationRef`, `jumpToNoteByAnnotation`, `getNotes`, `getCurrentNote`

---

### 3.6 `library.js` — 文献库管理（198 行）

**职责**：PDF 导入、列表展示、切换、删除。

**功能**：
- 文件选择 + 拖放导入 PDF
- 同名文件覆盖导入
- 按最近打开时间排序
- 删除时级联清理标注和笔记

**导出函数**：`initLibrary`, `selectPdf`, `getPdfMeta`, `getCurrentPdfId`, `getPdfList`

---

### 3.7 `search.js` — 搜索模块（181 行）

**职责**：全文搜索标注文本和笔记内容，高亮搜索词，点击跳转。

**工作流**：
1. 输入搜索词（300ms 防抖）
2. 调用 `storage.searchAll()` 全文搜索
3. 结果分组为「标注」和「笔记」
4. 搜索词高亮 + 上下文截取

---

### 3.8 工具模块

#### `utils/dom.js`（71 行）
- `$()` / `$$()` — 选择器简写
- `createElement()` — 声明式创建 DOM 元素
- `formatFileSize()` / `formatDate()` — 格式化工具
- `truncateText()` / `debounce()` — 通用工具

#### `utils/export.js`（77 行）
- `chooseDirectory()` — File System Access API 选择目录
- `exportNoteToDir()` — 导出单个笔记到目录
- `downloadNote()` — 浏览器下载笔记
- `exportAllNotes()` — 批量导出

---

## 四、UI 布局

```
┌───────────────────────────────────────────────────────────┐
│  📖 ScholarMark    │  [文献名]  │   [🌙主题] [⚙️设置]   │  ← Header
├──────────┬─────────┴───────────┬───────────────────────────┤
│          │                     │                           │
│  📁文献库 │                     │  📝编辑 / 👁预览 / 🎯标注│  ← Tabs
│  ─────── │                     │  ─────────────────────── │
│  🔍搜索  │    PDF 阅读器       │  📄笔记选择             │
│  ─────── │   (Canvas渲染)      │  ─────────────────────── │
│  📄文件1 │  [◀ 1/10 ▶]        │  Markdown 编辑器         │
│  📄文件2 │  [🔍-  100% 🔍+]   │  / 预览 / 标注列表       │
│  📄文件3 │                     │                           │
│          │                     │  ─────────────────────── │
│  ─拖放区─│                     │  [📥导出] [📦全部] [📂路径]│
├──────────┤                     ├───────────────────────────┤
│  ↔可拖拽  │                     │  ↔可拖拽                  │
└──────────┴─────────────────────┴───────────────────────────┘
```

---

## 五、数据流图

```
用户操作                     模块                        存储
────────                     ────                        ────
导入PDF ──────────→ library.js ──────────→ storage.js ──→ IndexedDB
选择PDF ──────────→ library.js
                      │
                      ├──→ pdf-viewer.js（渲染PDF）
                      ├──→ annotator.js（加载标注）
                      └──→ note-editor.js（加载笔记）

选中文本 ─→ pdf-viewer.js ─→ annotator.js（显示工具栏）
点击颜色 ─→ annotator.js ──→ storage.js（保存标注）
点击📝  ─→ annotator.js ──→ note-editor.js（插入引用）

编辑笔记 ─→ note-editor.js ──→ storage.js（自动保存）
搜索    ─→ search.js ────────→ storage.js（全文搜索）
导出    ─→ export.js ────────→ File System Access API
```

---

## 六、依赖关系

| 依赖包 | 版本 | 用途 |
|--------|------|------|
| `pdfjs-dist` | ^4.9.155 | PDF 解析与渲染 |
| `marked` | ^15.0.6 | Markdown → HTML 转换 |
| `highlight.js` | ^11.11.1 | 代码语法高亮 |
| `vite` | ^6.0.0 | 开发服务器与构建工具 |

---

## 七、现有功能总结

| 功能模块 | 状态 | 说明 |
|----------|------|------|
| PDF 加载渲染 | ✅ | 全页渲染、文本层、高亮层 |
| 翻页导航 | ✅ | 前进/后退/跳页/滚动同步 |
| 缩放 | ✅ | 步进缩放 + 适应宽度 |
| 文本选中标注 | ✅ | 5种颜色，浮动工具栏 |
| 标注管理 | ✅ | 创建/删除/分组列表/闪烁定位 |
| Markdown 笔记 | ✅ | 编辑/预览/自动保存 |
| 标注↔笔记双向跳转 | ✅ | 引用插入 + 点击跳转 |
| 文献库 | ✅ | 导入/拖放/列表/删除 |
| 全文搜索 | ✅ | 搜索标注和笔记内容 |
| 导出 | ✅ | 单个/批量导出 Markdown |
| 主题切换 | ✅ | 深色/浅色主题 |
| 设置 | ✅ | 存储路径设置 |
| 数据持久化 | ✅ | IndexedDB 完整 CRUD |

---

## 八、可改进方向（供参考）

### 体验优化类
1. **PDF 懒加载**：当前一次性渲染所有页面，大文件可能卡顿
2. **快捷键支持**：翻页、缩放、保存等快捷键
3. **笔记标题可编辑**：当前笔记标题为自动生成的"笔记 N"
4. **页面大纲/目录**：读取 PDF 目录书签，方便导航
5. **全屏阅读模式**：隐藏两侧面板

### 功能增强类
6. **PDF 内文本搜索**：在当前 PDF 内搜索文本并高亮
7. **手绘/笔刷标注**：除了高亮，支持下划线、删除线等
8. **标注评论**：标注可附加评论文字
9. **笔记模板**：预设论文阅读笔记模板
10. **标签/分类系统**：为文献添加标签进行分类管理
11. **多窗口/分屏**：同时打开两个 PDF 对比阅读

### 技术改进类
12. **虚拟滚动**：只渲染可视区域的 PDF 页面
13. **数据导入/备份**：导入/导出全部数据
14. **PWA 离线支持**：Service Worker 缓存
