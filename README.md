# ScholarMark

一个基于浏览器的 PDF 文献阅读、标注与笔记工具，支持 Markdown、公式渲染、文献总结模板、笔记内目录跳转与本地自动保存。

## 本地环境配置

### 1. 环境要求

- Node.js `>= 18`（建议 `20+`）
- npm `>= 9`
- 现代浏览器（推荐 Chrome / Edge）
- Windows / macOS / Linux

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发环境

```bash
npm run dev
```

默认地址：

- `http://localhost:5173`

### 4. 构建生产版本

```bash
npm run build
```

### 5. 预览生产包

```bash
npm run preview
```

### 6. 编码检查（防乱码）

```bash
npm run check:encoding
```

并且 `npm run build` 前会自动执行编码检查（`prebuild`）。

## 本地自动保存配置

项目支持将笔记/总结自动保存到本地目录（File System Access API）。

### 首次配置

1. 打开应用后点击右上角设置
2. 选择存储目录（例如：`D:\Work\note\文献笔记`）
3. 授权写入权限

### 保存行为

- 笔记编辑后自动保存（防抖）
- 文献总结编辑后自动保存（防抖）
- 保存结构：
  - `文献名/笔记名.md`
  - `文献名/文献总结.md`

### 注意事项

- 首次必须手动选择目录，浏览器不允许静默指定绝对路径并授权
- 清理站点权限/站点数据后，需重新选择目录

## 方案二：PM2 本机常驻（固定 localhost）

适合持续开发，免去每次手动启动命令。

### 1. 全局安装（一次）

```bash
npm i -g pm2 pm2-windows-startup
```

### 2. 启动服务（使用固化参数）

```bash
pm2 start ecosystem.config.cjs
```

### 3. 设置开机自启（一次）

```bash
pm2-startup install
pm2 save
```

### 4. 常用管理命令

```bash
pm2 status
pm2 logs pdf-reader
pm2 restart pdf-reader
pm2 stop pdf-reader
pm2 delete pdf-reader
pm2 restart ecosystem.config.cjs
```

### 5. 更新代码后的建议流程

如果只改了源码（`src/`、`index.html`、样式）：

```bash
pm2 restart pdf-reader
```

只有在依赖变化时（`package.json` / `package-lock.json` 变更）才需要：

```bash
npm install
pm2 restart pdf-reader
```

### 6. 访问地址

- `http://localhost:5173`

## 功能介绍

### 1. 文献库管理

- 导入 PDF（文件选择 / 拖拽）
- 文献列表展示与切换
- 删除文献（级联删除对应标注、笔记、总结）

### 2. PDF 阅读

- 翻页、缩放、适应宽度
- 文本层可选中
- 阅读进度记忆（按文献保存页码与缩放）

### 3. 标注系统

- 选中文本后创建高亮标注（多颜色）
- 右键标注可查看关联笔记、删除标注
- 点击标注可联动跳转

### 4. 笔记系统（Markdown）

- 多笔记管理（每篇 PDF 独立）
- 编辑 / 预览 / 标注三 Tab
- 自动保存到本地数据库
- 公式渲染（KaTeX）
- 代码高亮（highlight.js）

### 5. 笔记内目录（基于标注引用）

- 左侧嵌入式目录（可折叠）
- 目录项来自标注引用句子
- 点击目录项可跳转到编辑/预览对应引用块
- 长句自动截断，悬浮显示完整内容

### 6. 文献总结模块

- 独立于笔记的总结工作区（编辑 / 预览）
- 默认模板：研究内容、研究方法、研究结果、讨论
- 支持重置模板与导出

### 7. 搜索

- 全局搜索标注与笔记内容
- 点击结果联动到对应文献与位置

### 8. 导出

- 导出当前笔记
- 批量导出全部笔记
- 导出文献总结
- 支持浏览器下载与目录写入

## 数据存储说明

### IndexedDB（核心）

- 数据库：`ScholarMarkDB`
- 存储：`pdfs`、`annotations`、`notes`、`summaries`、`settings`

### localStorage（轻量 UI 状态）

- 主题模式
- 目录折叠状态

## 目录结构

```text
pdf-reader/
├─ index.html
├─ src/
│  ├─ main.js
│  ├─ modules/
│  │  ├─ pdf-viewer.js
│  │  ├─ annotator.js
│  │  ├─ note-editor.js
│  │  ├─ summary-editor.js
│  │  ├─ library.js
│  │  ├─ search.js
│  │  ├─ outline.js
│  │  └─ storage.js
│  ├─ styles/
│  └─ utils/
├─ scripts/
│  └─ check-encoding.mjs
└─ package.json
```

## 常见问题

### 1. 为什么每次都要重新选存储目录？

通常是因为浏览器站点权限或站点数据被清理。重新选择目录并授权即可恢复。

### 2. 数据会不会丢？

本地数据依赖浏览器存储。清理站点数据、无痕模式结束、重装系统/换设备都可能导致数据不可恢复，建议定期导出备份。
