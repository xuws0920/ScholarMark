# ScholarMark PDF 文献阅读器 — 开发进展

## 当前状态：✅ 核心功能 + 公式渲染 + 目录大纲

**更新时间**：2026-02-13 15:23

---

## 已完成的工作

### 1. 项目基础搭建
- 使用 Vite + 原生 JS 构建
- 引入依赖：`pdfjs-dist`（PDF 渲染）、`marked`（Markdown 解析）、`highlight.js`（代码高亮）
- 暗色学术主题 UI 设计系统

### 2. PDF 渲染模块 (`pdf-viewer.js`)
- 基于 PDF.js 加载和渲染 PDF
- 翻页、缩放（50%-300%）、适应宽度
- 文本层实现文本选取
- 高亮标注层

### 3. 文本标注模块 (`annotator.js`)
- 选中文本弹出浮动工具栏
- 5 种标注颜色（黄、绿、蓝、紫、红）
- 标注数据持久化到 IndexedDB
- **核心：点击标注 → 跳转到关联笔记**

### 4. Markdown 笔记模块 (`note-editor.js`)
- Markdown 编辑 + 实时预览
- 一键将选中 PDF 文本插入为引用块
- 标注↔笔记双向跳转
- 多笔记管理（每个 PDF 独立）
- 自动保存
- **✨ 新增：LaTeX 数学公式渲染（KaTeX）**
  - 行内公式：`$E=mc^2$`
  - 块级公式：`$$\sum_{i=1}^n x_i$$`

### 5. 文献库管理 (`library.js`)
- PDF 导入（文件选择 + 拖放）
- 文献列表展示与切换
- 删除文献（同时清理标注和笔记）

### 6. 搜索模块 (`search.js`)
- 全文搜索标注和笔记内容
- 搜索结果分组展示
- 点击跳转到对应 PDF/标注

### 7. 导出功能 (`export.js`)
- File System Access API 选择本地目录
- 按「PDF文件名/笔记.md」结构导出
- 支持批量导出

### 8. 数据持久化 (`storage.js`)
- IndexedDB 存储 PDF、标注、笔记、设置
- 完整 CRUD 操作

### 9. ✨ PDF 目录大纲 (`outline.js`)
- 自动提取 PDF 文档目录书签
- 可折叠的树形目录结构
- 点击目录项跳转到对应页面
- 左侧栏 Tab 切换（文献库 ↔ 目录）

---

## 开发服务器
- 地址：http://localhost:5173/
- 启动命令：`npm run dev`

## 待优化项
- 浏览器测试工具暂不可用，需要用户手动在浏览器中测试
- 后续可根据实际使用反馈优化 UI 细节

---

## 最新修复记录

### 2026-02-20：修复双页视图原文 PDF 不显示问题
- **问题**：切换到双页（split-view）模式后，左侧原文 PDF 页面被压缩到接近 0 高度
- **根因**：`.pdf-page-wrapper` 在 flex column 布局中默认 `flex-shrink: 1`，split-view 模式下 `#pdf-pages` 高度被约束，所有页面 wrapper 被 flex 压缩
- **修复**：
  - `pdf-viewer.css`：给 `.pdf-page-wrapper` 和 `.page-number-label` 添加 `flex-shrink: 0`
  - `pdf-viewer.js`：导出 `fitWidth` 函数
  - `main.js`：切换 split-view 后调用 `fitWidth()` 重新适配宽度

### 2026-02-20：中栏双页视图可拖动调整宽度
- **功能**：split-view 模式下，PDF 原文与翻译预览之间新增可拖动分隔条
- **实现**：
  - `index.html`：在 `#pdf-pages` 和 `#pdf-translation-pane` 之间插入 `#resize-split`
  - `pdf-viewer.css`：分隔条样式（默认隐藏，split-view 下显示），翻译面板 min/max 宽度约束
  - `main.js`：`setupSplitResize()` 实现拖拽交互，面板宽度持久化到 localStorage，拖拽结束自动 `fitWidth()`
