# 2code UI 完整清单（换框架重写规格）

这份文档是 2code 桌面端 **全部可见 UI 的框架无关规格**。目标：之后用任何 UI 技术栈重写时，不必再读 React / Tailwind / shadcn 源码，也能按相同产品形态还原窗口、页面、组件树、排布、尺寸、交互、空态、错误态和文案。

**审计日期：** 2026-09-03  
**对照代码：** 主窗口 `src/App.tsx`、`src/layout/*`、`src/features/*`、`src/components/ui/*`、`src/app.css`、`src-tauri/tauri.conf.json`、`src-tauri/src/handler/window.rs`、`messages/en.json`

**更细的 className / 像素对照（英文附录）：**

| 附录 | 覆盖面 |
|------|--------|
| [sidebar-ui-inventory.md](./sidebar-ui-inventory.md) | 应用侧栏、项目分组、头像、Profile 次级侧栏原语 |
| [ui-inventory-home-project.md](./ui-inventory-home-project.md) | 首页、Profile 布局、文件树、文件查看器、命令面板、项目/Profile 对话框 |
| [ui-inventory-settings-terminal-git-debug-updater.md](./ui-inventory-settings-terminal-git-debug-updater.md) | 设置窗、终端、Git 大对话框、调试、更新器 |

本文是 **主规格**：先读本文，再按需要查附录。文中尺寸、文案、树结构均来自源码，不 invent。

---

## 0. 怎么用这份文档重写

重写时按「窗口 → 区域 → 组件 → 状态」还原，不要按当前 React 组件名还原。

1. **先还原窗口壳**：两个 Webview、原生标题栏、拖拽区、Windows 自定义按钮。
2. **再还原主窗三分区**：应用侧栏 | 主内容 | 持久终端层。
3. **再还原 Profile 工作区**：顶栏 + 次级侧栏（Files/Git/Notes）+ 统一标签栏 + 终端/文件查看器。
4. **最后还原叠加层**：对话框、命令面板、右键菜单、Toast、调试 FAB、新手引导。

**不可破坏的产品不变量：**

- 终端实例 **不能因切标签/切路由而销毁**。隐藏用 CSS `display:none` / `visibility:hidden`，不要条件卸载。
- 文件树在 Files/Git/Notes 切换时也 **保持挂载**（`display:none`），以免丢失展开/选中状态。
- 设置是 **独立窗口**，不是主窗内路由页。
- `Cmd+,` 开设置；`Cmd+Shift+D` 开调试面板；`Cmd+K` 开文件搜索；`Cmd+T`/`Cmd+W` 开/关终端标签。
- 文案走 i18n（英/中）。品牌字 `"2Code"` 硬编码，不要翻译。

---

## 1. 产品表面总图

2code 是本地优先的「项目 + Profile（git worktree）+ 持久 PTY 终端」工作站。用户看到的全部表面：

```
操作系统
├── 主窗口 "2code"  1440×900  叠加标题栏
│   ├── 应用侧栏（项目列表）
│   ├── 主内容
│   │   ├── 首页（仅无项目时停留）
│   │   └── Profile 工作区（有项目后的主界面）
│   │       ├── 顶栏
│   │       ├── 次级侧栏：Files | Git | Notes
│   │       └── 统一标签栏 + 终端 / 文件查看器
│   ├── 叠加层：对话框、命令面板、右键菜单、Toast
│   ├── 调试扳手按钮（可选）
│   └── Windows 右上角 min/max/close
│
└── 设置窗口 "Settings"  880×640
    └── 六个标签：General / Terminal / Templates / Notification / Top Bar / About
```

**没有的表面：** 登录、账号、云同步、独立「项目列表页」（有项目会立刻跳进第一个默认 Profile）、移动端布局、汉堡菜单。

---

## 2. 窗口与原生铬

### 2.1 主窗口

| 项 | 值 |
|----|----|
| 内部 title | `2code` |
| 可见标题文字 | 隐藏（`hiddenTitle: true`） |
| 装饰 | 系统 decorations 开 |
| 标题栏样式 | **Overlay**（内容顶到标题栏下） |
| macOS 红绿灯 | 左上，坐标 **x=16, y=24** |
| 默认尺寸 | **1440 × 900**，居中 |
| 可最大化 | 是 |

因为 overlay 标题栏，应用必须自己留出红绿灯和拖拽区：

- 应用侧栏 **header** 标 `data-tauri-drag-region`。macOS 上 `padding-top: 32px`（`pt-8`），其它平台 `8px`（`pt-2`）。
- 首页 header、Profile 顶栏也是拖拽区。
- 拖拽区内的按钮/链接必须 `no-drag`，否则点不到。
- 应用侧栏折叠后，macOS 顶栏左侧再加 `padding-left: 84px`，避开红绿灯。
- Windows 顶栏右侧 `padding-right: 118px`，避开自定义窗口按钮。

### 2.2 设置窗口

| 项 | 值 |
|----|----|
| Webview label | `settings` |
| 标题 | `Settings` |
| URL | 同一个 `index.html`；前端看 label 决定渲染 `SettingsWindow` 而不是 `App` |
| 默认尺寸 | **880 × 640** |
| 最小尺寸 | **600 × 420** |
| 居中 | 是 |
| 装饰 | 系统默认（**不是** overlay） |

打开方式：

- 侧栏底部 Settings
- `Cmd+,` / `Ctrl+,`
- 更新 Toast 的 “Open Update Page” → 复用同一窗口并切到 About（`?tab=about`）

已存在则 `show()` + `focus()`，不新建。设置窗 **不** 挂文件监视、终端层、应用侧栏、启动性能同步。设置项通过跨窗口 broadcast 同步回主窗。

### 2.3 Windows 自定义窗口按钮

仅 Windows 渲染。`fixed top-0 right-0`，高 **28px**（`h-7`），从左到右：

1. Minimize — 减号，12px，hover 灰底
2. Maximize / Restore — 未最大化是方框，最大化是「两份重叠」图标
3. Close — X，hover **#c42b1c** 白字，active **#b32717**

每个按钮 **28×36**（`h-7 w-9`），`no-drag`。

### 2.4 根布局（主窗）

```
html/body/#root = 100% × 100%，overflow:hidden
App
├── StartupUpdateCheck          （无 DOM，启动时可能弹 Toast）
├── 横向 flex，flex-1，min-height:0
│   ├── AppSidebar 或 SidebarSkeleton / SidebarError
│   └── main（relative, flex-1, overflow-y:auto, 背景 --card）
│       ├── Routes
│       │   ├── /        HomePage
│       │   ├── /projects/:id/profiles/:profileId   ProjectDetailPage
│       │   └── *        重定向 /
│       └── TerminalLayer（absolute inset 0 覆盖层）
├── DebugFloat（条件）
└── WindowControls（仅 Windows）
```

整窗背景 `--background`，文字 `--foreground`。侧栏背景 `--sidebar`，主区 `--card`。

**全局交互基调：** `body` 禁止文本选择、默认箭头光标。只有 `input` / `textarea` / `contenteditable` / `.xterm` / Markdown 编辑器允许选字。按钮、链接、`[data-sidebar-item]` 也是默认光标（不是 pointer），只有少数明确写了 `cursor-pointer` 的标题/分支例外。

---

## 3. 设计系统（视觉合同）

### 3.1 字体

| 用途 | 字体 |
|------|------|
| UI 正文 | Inter Variable → 系统栈（-apple-system, Segoe UI, Roboto…） |
| 标题 token | Geist Variable（`--font-heading`） |
| 等宽 / 终端 / 代码 / Markdown | 设置里的终端字体，CSS 变量 `--font-mono`，默认 JetBrains Mono 栈 |
| 抗锯齿 | `-webkit-font-smoothing: antialiased`，`text-rendering: optimizeLegibility` |

Phosphor 图标默认 **1em、duotone**。少数地方改 `weight="regular"`。

### 3.2 颜色 token（oklch）

亮色 `:root`：

| Token | 值 | 用途 |
|-------|-----|------|
| `--background` | `oklch(1 0 0)` | 窗体底 |
| `--foreground` | `oklch(0.145 0 0)` | 主文字 |
| `--card` | `oklch(1 0 0)` | 主内容区 |
| `--popover` | `oklch(1 0 0)` | 菜单/对话框/Toast |
| `--primary` | `oklch(0.205 0 0)` | 主按钮（近黑） |
| `--muted` | `oklch(0.97 0 0)` | 浅底、hover |
| `--muted-foreground` | `oklch(0.556 0 0)` | 次要文字 |
| `--destructive` | `oklch(0.577 0.245 27.325)` | 危险操作 |
| `--border` / `--input` | `oklch(0.922 0 0)` | 边框 |
| `--ring` | `oklch(0.708 0 0)` | 焦点环 |
| `--radius` | `0.625rem`（10px） | 基础圆角 |
| `--sidebar` | `oklch(0.985 0 0)` | 侧栏底（比主区略灰） |
| `--sidebar-accent` | `oklch(0.97 0 0)` | 侧栏 hover/选中 |
| `--app-focus-ring` | 系统 `Highlight` | 自定义焦点 |

暗色 `.dark`：背景 `oklch(0.145)`，卡片/弹出层 `oklch(0.205)`，主色反转成浅色，边框半透明白。侧栏暗色底与卡片同级。

**语义色（不走 token）：**

- Git 增加：`text-green-500` / `text-green-600`
- Git 删除：`text-red-500` / `text-red-600`
- Agent waiting：`bg-yellow-400`
- Agent completed：`bg-green-500`
- Agent running：`bg-emerald-400` + 1.4s 脉冲光晕
- 分支 “used” 徽章：琥珀底/字
- Windows 关闭按钮：`#c42b1c`

焦点环优先用系统 `Highlight` / `HighlightText`（选择色也是）。

### 3.3 圆角档位

设置里的 Border Radius 改 `--radius`。派生：

| 档 | 显示名 | 相对 `--radius` |
|----|--------|-----------------|
| none | None | 0 |
| small | Small | ×0.6 |
| medium | Medium | 默认 0.625rem |
| large | Large | ×1.4 |
| extra large | Extra Large | ×1.8 |

常用：按钮 `rounded-lg`，对话框 `rounded-xl`，头像 `rounded-md`，菜单 `rounded-lg`。

### 3.4 按钮规格

| size | 高 | 用途 |
|------|----|------|
| default | 32px（`h-8`） | 对话框主操作 |
| xs | 24px | 紧凑（改文件夹、重试） |
| sm | 28px | 次要 |
| lg | 36px | 少用 |
| icon | 32×32 | 顶栏齿轮、调试 FAB |
| icon-xs | 24×24 | 搜索条箭头 |
| icon-sm | 28×28 | 对话框关闭 |

| variant | 外观 |
|---------|------|
| default | 实心 primary |
| outline | 边框 + 白底，hover muted |
| secondary | 浅底 |
| ghost | 无底，hover muted |
| destructive | 浅红底 + 红字（不是大红实心） |
| link | 下划线链接 |

禁用：`opacity: 50%`，不可点。激活时轻微下移 1px。

### 3.5 标准对话框壳

默认对话框：

- 遮罩：全屏 `bg-black/10`，支持 backdrop 时轻微模糊，z-index 50
- 面板：水平垂直居中，默认 `max-w-sm`，内边距 16px，`rounded-xl`，`bg-popover`，细环 `ring-foreground/10`
- 打开：淡入 + 缩放到 95%
- 右上角默认有 ghost 关闭按钮（Git 大对话框关掉这个默认按钮，自己画关闭）
- 结构：Title（常带 16px 图标）→ 正文 gap 12–20px → Footer 右对齐（Cancel outline + 主按钮）

标准小对话框（创建/删除/重命名/未保存关闭）都用这套壳。Git Diff 是例外：`min(88rem, 100vw-2rem)` × `min(82dvh, 56rem)`，无内边距。

### 3.6 Toast

Sonner，跟主题走。图标 16px Phosphor regular：成功勾、信息 i、警告三角、错误叉、加载转圈。背景 `--popover`。启动更新 Toast 持续 **12 秒**，带 “Open Update Page” 动作。

### 3.7 空状态

居中 `Empty`：上方圆形图标容器 → 标题 → 灰色说明 → 可选操作按钮。用于：无项目、无终端、设置/模板空列表。

### 3.8 加载 / 错误

| 表面 | 加载 | 错误 |
|------|------|------|
| 应用侧栏 | 250px 宽骨架：一条标题 + 半宽标签 + 三条缩进行 | 同宽栏，红标题 “Something went wrong” + 消息 + Try again |
| 主页面 | 左上骨架：48×192 标题 + 两行 | 同样错误栈，padding 32px |
| 面板内部 | 居中 Spinner 16px | 居中错误栈 |
| 行内 | — | 左红标题+截断消息，右 xs Try again |
| 对话框体 | Spinner | 最小高 200px 居中错误栈 |

### 3.9 Agent 状态点

**8×8** 圆点，不可聚焦。

| 状态 | 颜色 | 动画 |
|------|------|------|
| waiting | 黄 `#facc15` | 无 |
| running | 翠绿 | 1.4s 脉冲光晕（`prefers-reduced-motion` 时关掉） |
| completed | 绿 `#22c55e` | 无 |

出现位置：侧栏默认 Profile / 非默认 Profile、终端标签。完成点可点消失（仅标签栏）。

---

## 4. 应用侧栏（左列）

### 4.1 尺寸与折叠

| 常量 | 值 |
|------|-----|
| 默认宽 | **250px** |
| 最小 / 最大 | **220 / 420** |
| 键盘步进 | 16px |
| 持久化 | localStorage `app-sidebar-width`（宽、是否折叠、折叠的分组 id） |

折叠时侧栏 **整棵不渲染**。展开按钮只出现在 Profile 顶栏左侧（首页折叠后没有展开钮）。

右缘有 **8px** 宽竖直 resize 热区，中线 1px。拖时中线变 `foreground/30`，hover/焦点时显示 border 色。

### 4.2 结构（上 → 下）

```
Sidebar（role=navigation, aria-label="Side navigation"）
├── Header（拖拽区）
│   ├── 左：不可点品牌 "2Code"（semibold）
│   └── 右：折叠按钮 SidebarSimple 图标
├── Content（竖向滚动，stable scrollbar gutter）
│   ├── [无项目] Home 行（房子图标 + "Home"）
│   ├── [有置顶] 分组 "Pinned"
│   │   └── 项目行…
│   └── 分组 "Projects"
│       ├── 标签右侧：铅笔（排序）+ 加号（新建项目）#add-project-button
│       └── 顶层条目：项目 或 分组
└── Footer
    └── Settings 行（齿轮 + "Settings"）
```

无项目时 Content 里只有 Home。有项目时 Home 不出现（首页会立刻跳走）。

键盘：在侧栏内 ↑/↓ 在所有 `[data-sidebar-item]` 间循环。

### 4.3 普通模式：项目行

一行从左到右：

1. **头像 16×16**（可在设置关掉）
   - 有 GitHub avatar URL：封面图
   - 失败/无图：侧栏 accent 底 + 项目名第一个大写字母，10px
   - 空名：`?`
2. **项目名** medium、截断
3. 右侧动作：
   - **只有默认 Profile：** hover/焦点时显示 `+`（新建 Profile）；平时若有 agent 状态则显示状态点（hover 时点隐藏、`+` 出现）
   - **有额外 Profile：** 展开/折叠 caret（默认展开）

点击项目名 → 进默认 Profile。

**右键菜单：**

1. Add to Project Group ▸
   - 已有分组列表（当前分组打勾、禁用）
   - 若已在分组：Remove from Project Group
   - Create Project Group，或直接出现输入框（无分组时）
   - 输入占位 `e.g. Work`，Enter 创建并加入，Esc 取消
2. Project Settings
3. Rename
4. — 分隔 —
5. Delete Project（destructive）

### 4.4 展开后的 Profile 子列表

缩进子菜单：

1. 第一行永远是 **Default**（终端窗图标 + 文案 “Default” + 可选状态点）
2. 其余 Profile：Git 分支图标 + `branch_name`（溢出出 tooltip）+ 状态点
3. 最后一行：`+` + “New Profile”

非默认 Profile 右键只有 **Delete Profile**（destructive）。

### 4.5 项目分组

分组行：caret + 分组名 + 右侧数字徽章（项目数）。点击折叠。展开用 180ms 高度/透明度动画（`[0.22,1,0.36,1]`），尊重 reduced motion。

分组内项目与顶层项目同一套行/菜单。

### 4.6 排序模式

点铅笔进入。项目/分组变成可拖行：

- 左：六点拖手（`cursor-grab`）
- 中：头像或文件夹图标 + 名
- 右：星标钉/取消钉

分区：

1. **Pinned** — 已钉项目 + 虚线投放区 “Drop here to pin”
2. **Projects** — 顶层项目与分组交错；分组下再嵌套项目 + “Drop project into folder”；底部 “Drop here to unpin or move out”

保存中禁用拖拽。标签右侧铅笔换成 **勾**（完成）+ 加号。拖拽中行透明度 0.45，背景 sidebar-accent。

### 4.7 侧栏骨架 / 错误

宽固定 250px，右边框，`bg-muted/40`，内边距 16px。错误时居中错误栈。

---

## 5. 首页

有项目时 **立刻 replace 导航** 到第一个项目的默认 Profile，用户几乎看不到首页内容。

无项目时：

```
HomePage（满高）
├── header 高 52px，底边框，左右 padding 20px，拖拽区
│   ├── Folder 图标 16px muted
│   └── "Home" semibold 14px
├── 剩余高度居中 Empty
│   ├── FolderPlus 图标
│   ├── "No projects yet"
│   └── "Create your first project from the sidebar to get started."
└── TourOnboarding（无 React DOM）
```

新手引导：300ms 后用 driver.js 指向侧栏 `#add-project-button`。气泡在右侧、上对齐。标题 “Create your first project”，说明 “Click here to add a project folder and get started.” 只有关闭按钮。点加号会销毁引导。

---

## 6. Profile 工作区（主界面）

### 6.1 谁在画这块 UI

两条路径，外观必须一致：

| 条件 | 谁渲染 ProfileLayout |
|------|----------------------|
| 该 Profile **没有任何** 终端标签和文件标签 | `ProjectDetailPage` 画空态 CTA |
| 该 Profile **至少有一个** 标签 | `TerminalLayer` 用 absolute overlay 画完整工作区；`ProjectDetailPage` 返回 null |

`TerminalLayer` 为 **每一个曾经开过标签的 Profile** 各挂一份 `ProfileLayout`，非当前路由的用 `display:none`。切项目/Profile 不卸载终端。

无效 project/profile → 回默认 Profile 或 `/`。

### 6.2 布局

```
ProfileLayout  竖向满高
├── CommandPalette（始终挂着，关时不可见）
├── 底边框
│   └── ProjectTopBar  最小高 44px
└── 横向 flex-1，min-width/height 0
    ├── ProfileSidebar  默认 208px，可 180–560
    └── 主列 flex-1
        └── TerminalTabs
            ├── 标签栏（终端标签 + 文件标签 + 新建）
            ├── 文件查看器（仅文件标签激活时）
            └── 终端层（永不卸载，文件标签激活时 display:none）
```

次级侧栏关时宽度动画到 0，`pointer-events:none`，`aria-hidden`。弹簧：stiffness 320, damping 34, mass 0.9。宽度存在 localStorage `file-tree-panel`。

---

## 7. 顶栏（ProjectTopBar）

三区叠在同一条 **最小 44px** 高的条上，底对齐，左右 padding 16px，上 4px 下 6px，整条拖拽区。

```
[ 左：展开侧栏? + Files/Git/Notes ]     [ 绝对居中：项目名 + 分支 ]     [ 右：可配置控件 + 齿轮 ]
```

居中块 `pointer-events:none`，内部按钮再打开；左右各留 128px（`px-32`）以免和两侧重叠。

### 7.1 左

1. 应用侧栏折叠时：ghost icon 按钮，SidebarSimple，tooltip “Expand sidebar”
2. **SidebarModeSwitch** — 高 28px 的三段 tab
   - Files：FolderSimple 14px
   - Git：GitBranch 14px + 可选 `+N` 绿 / `-M` 红
   - Notes：Note 14px
   - 只有图标，文字在 tooltip
   - 侧栏关闭时三段都未选中
   - **再点当前模式 = 关闭侧栏**；点其它模式 = 切模式并打开

快捷键（仅当前 Profile）：`Cmd/Ctrl+E` 开关侧栏，`Cmd/Ctrl+G` 开 Git Diff 大对话框。

### 7.2 中

- **项目名** semibold，可点，tooltip 显示 worktree 绝对路径；点击在系统文件管理器中显示该目录
- **分支**：Git 图标 + 名
  - 默认 Profile：拉当前 git 分支；非活动 overlay 不拉
  - 非默认 Profile：显示 `profile.branch_name`
  - 点击打开 Switch Branch 对话框
  - muted，hover 变主色

### 7.3 右

用户在设置 Top Bar 里配置的控件（只显示本机已安装的）：

| id | 外观 | 行为 |
|----|------|------|
| `github-desktop` | GitHub 标 | 用 GitHub Desktop 打开当前 worktree |
| `editor` | Code 标 | 用所选编辑器打开（VS Code / Cursor / Windsurf / Zed / Sublime） |
| `terminal` | 终端窗标 | 用所选终端打开（Ghostty / iTerm2 / kitty / Warp） |
| `pr-status` | PR 标 + 状态 | Checking / No PR / Open / Draft / Merged / Closed；tooltip 带号和标题 |

最右固定 **齿轮** secondary icon，开 **项目设置对话框**（不是应用设置窗）。

---

## 8. 次级侧栏三模式

右缘 8px resize，aria “Resize sidebar”，键盘 ±16 / Home / End。

### 8.1 Files — 文件树

Pierre FileTree，compact，完整图标，粘性文件夹，默认全收起。

| 视觉 | 值 |
|------|-----|
| 字号 | 13px |
| 缩进 | 12px / 级 |
| 行左右 padding/margin | 4px |
| 选中底 | `--muted` |
| 外包 | `px-1.5 py-1` + 右边框 |
| 打开动画 | 18ms，opacity + 左移 12px |

**交互：**

- 单击文件 → 在统一标签栏开文件标签
- 单击目录 → 展开/折叠
- 多选 / Cmd / Shift 点击不自动打开
- 树内拖拽移动；拖到终端标签或终端区域会把路径写进 PTY
- 内联重命名；新建草稿名硬编码 `"New File"` / `"New Folder"`（重名加数字）
- Git 状态混进路径列表（未跟踪/改动的文件即使目录未扫到也会出现）

**条目右键：** Open · Open in Default App · Reveal in Finder · Refresh · New File · New Folder · Rename · Copy Relative Path · Copy Absolute Path · Delete（红）

**空白/根右键：** New File · New Folder · Refresh · Reveal in Finder · Copy Relative / Absolute Path（根）

加载中树自身处理；路径错误时半透明错误字叠在树上（不挡操作）。

### 8.2 Git — 紧凑变更面板

```
竖向满高
├── ChangesFileList（可滚）
│   └── sticky 头：全选 checkbox + "{n} changed file(s)" + 放大开 Diff 对话框
│   └── 文件行：checkbox + 图标 + 名 + A/D/M/R 徽章 + discard
└── CommitComposer（底，上边框，padding 10×8）
    ├── 小写标题 COMMIT
    ├── Summary 单行（高 28px）
    ├── Description 多行（最小 4.5rem）
    ├── "{included} of {total} files included" + All / None
    ├── Commit 按钮（需有摘要且至少勾一个文件）
    └── 若 ahead>0：Push 按钮 + 上传图标
```

空列表： “No changes detected”。双击文件打开大 Diff 并选中该文件。`Cmd/Ctrl+Enter` 提交。

### 8.3 Notes

懒加载 Markdown 编辑器，占满侧栏。占位 “Write notes for this profile…”。自动保存。状态徽章：Saving / Saved / Failed。失败 Toast “Notes save failed”。

---

## 9. 统一标签栏 + 终端 + 文件查看器

### 9.1 标签栏

一条横滚、底边框的 line tabs。每个 trigger `max-width: 14rem`（`max-w-56`），左对齐。

**终端标签（左起）：**

1. 图标 14px：标题含 claude/codex/gemini/kimi/cline/openclaw/opencode/qoder 则用对应彩色 SVG，否则 TerminalWindow
2. 标题截断
3. 运行/等待状态点；若只有 completed，点可点掉
4. 关闭 X（16px 热区，12px 图标），`aria-label="Close {title}"`

终端标签是文件树路径的 drop target。

**文件标签（接在终端后面）：**

1. 文件类型图标 14px
2. 文件名截断
3. 未保存：8px muted 圆点
4. 关闭（脏则先弹确认）

**最右：New Terminal**

- 无模板：一个 `+ New Terminal` tab-looking 控件
- 有模板：主按钮 + 右侧 caret 分裂按钮，菜单分 **Project Templates** / **Global Templates**
  - 项目模板可显示相对 cwd 副文案
  - 空提示去项目设置或应用设置加模板

### 9.2 空终端 CTA（无任何标签时）

居中 Empty：终端窗图标 + “No terminals open” + “Open a terminal to start working in this project.” + 同上的 New Terminal（可分裂）。分裂按钮 `aria-label` 硬编码 `"Choose template"`。

### 9.3 终端本体

每个会话一个 xterm.js，绝对铺满标签下区域。非活动：`visibility:hidden` + `pointer-events:none`。恢复中居中 Spinner。

**必须遵守：** 不要因切标签卸载 xterm。WebKit 下字体测量必须用挂在 document 里的 canvas，否则半角字宽测错、右侧空一截。

终端内：

- 搜索条：右上绝对定位（`top/right: 12px`），半透明底、边框、阴影。输入宽 224px 高 28px + `n/m` 或 “No results” + 上/下/关。Esc 关，Enter 下一个，Shift+Enter 上一个。高亮：普通匹配褐底 `#5f4b16`，当前蓝 `#1f6feb`。
- 点链接：确认框，说明可 Ctrl+点击跳过；显示 URL；Default Browser / Open With。
- 点文件路径：在工作区内则开文件标签；歧义则选择列表；工作区外提示不能打开。
- 主题 10 套：GitHub Dark/Light、Dracula、Ayu Dark/Light、Solarized Dark/Light、One Dark/Light。暗/亮模式可各选一套，或同步。

全局（当前 Profile）：`Cmd+T` 新终端，`Cmd+W` 关当前终端。

### 9.4 文件查看器

按扩展名三条路：

**A. 文本（非 md）— Monaco**

- 满高，无 minimap，无 word wrap，padding 上下 12px
- 字体 = 终端字体 + ligatures，字号 = 终端字号
- 主题：终端主题名含 `light` 用 `light`，否则 `vs-dark`
- TS/JS 诊断关闭
- `Cmd/Ctrl+S` 保存（窗口级 + 编辑器命令）
- 草稿 400ms 防抖；脏点在标签上

**B. Markdown / MDX — Milkdown**

顶工具条（`px-2 py-1`，xs 图标按钮）+ 编辑区。工具：段落/H1–H3、粗斜代码删、链接、列表、引用、代码块、表、分割线、保存。`/` 斜杠菜单（最小宽 180、最高 280）。代码块深色 `#282c34`，语言选择器 240px，预览最高 420px。保存徽章与 Notes 相同。

**C. 二进制预览**

顶条高 ≥36px，muted 底：文件名 + 右侧 “Preview” 或 “Office Preview”。

- 图：棋盘透明底，contain
- PDF / Office→PDF：白底 iframe
- 压缩包：`ArchivePreviewTree`，统计硬编码 `"{n} files / {m} folders"`
- 其它：“Preview unavailable”（硬编码）

加载：高 128px 居中 Spinner。错误：居中 muted 消息。

关脏文件：对话框 “Close Unsaved File?” + “{file} has unsaved changes…” + Cancel / Discard Changes（红）。

---

## 10. 命令面板（Cmd/Ctrl+K）

仅当前活动 Profile。

| 项 | 值 |
|----|-----|
| 遮罩 | 全屏 40% 黑，z 1400 |
| 面板 | 顶距 72px，水平居中，宽 `min(100%, 40rem)`，最高 `100vh-96px` |
| 圆角 | 8px |
| 边框 | `--border` |
| 背景 | `--popover` |

结构：

1. 底边框搜索行，`px-4 py-3`，无边框输入，16px，占位 “Search files by name…”
2. 列表最高 60vh：每项 图标16 + 文件名 14px + 父路径 12px muted；选中 `bg-muted`
3. 空：未输入 “Start typing…”；无结果 “No matching files found.”；错误显示消息

打开后 focus + 全选。选中 Enter → 开文件标签并关面板。自管过滤关（`shouldFilter=false`），结果来自后端搜索。

---

## 11. Git 大对话框

`Cmd+G` 或侧栏 Git 放大、或顶栏逻辑打开。

```
DialogContent  宽 min(88rem, 100vw-2rem)  高 min(82dvh, 56rem)  无默认关闭钮
├── Header（底边框，px-4 py-2）
│   ├── 左：Git 图标 + 分支名（缺省显示硬编码 "main"）
│   ├── 中右：Unified / Split toggle
│   └── 关 X
└── 横向 flex-1
    ├── 左栏约 360px
    │   └── Tabs: Changes | History
    │       ├── Changes：文件列表 + CommitComposer（与侧栏同构，更宽）
    │       └── History：提交列表 → 点进后变该提交的文件列表 + Back
    └── 右：Diff pane（Pierre diffs + Shiki，主题跟终端主题映射）
```

文件徽章：A / D / M / R。大 diff（超过阈值的行数）默认折叠，说明 “Large diff hidden by default”，按钮 “Load diff anyway”。重命名显示 Previous/Current path。图片 Before/After。二进制不可预览走 “Preview unavailable”。

Review Queue：浮动按钮，收集 diff 评论，可复制/复制并清空。

History 空：“No commits found”。无文件变更：“No file changes”。未选文件：“Select a file to view changes”。

---

## 12. 设置窗口（六个标签）

顶：横向 TabsList，`margin: 20px 20px 0`，溢出横滚。每项 图标 + 字。默认 General（URL 无 `tab`）；其它写入 `?tab=`。

内容区 `padding: 20px`，可滚。

### 12.1 General

单列 `max-w-md`，项间距 24px。

1. **Language** — native select：English / 中文
2. **Theme** — System / Light / Dark（应用 chrome，不是终端）
3. **Border Radius** — 五档
4. **Default Worktree Directory** — 输入，占位 `Default: ~/.2code/workspace`，可清空。说明：项目没设 `worktree_dir` 时新 Profile 用它；相对路径相对项目根
5. **Debug Mode** — 横排：标题+说明 / Switch。说明 “Show backend log events in a floating panel.”
6. **Performance Profiling** — 同上，写前后端 trace
7. **Show Project Avatars** — 控制侧栏 16px 头像

### 12.2 Terminal

左列（`max-w-md`）+ 右列实时 `TerminalPreview`，间距 32px。

左：终端主题（可预览 hover）、Default Shell（系统列表 + Custom 路径）、Font（系统字体，可 “Show all fonts”）、Font Size stepper。Shell/Font 加载失败：70px 高骨架或 InlineError。

### 12.3 Terminal Templates

`max-w-2xl`。全局模板列表：名、shell、cwd、命令（一行一条）。增删改。空：“No templates yet.”

### 12.4 Notification

总开关 “Enable Notifications” + 说明。Sound：系统音列表或 None；不可用时 “No system sounds”。Agent 等待会弹系统通知并按配置播放声音。

### 12.5 Top Bar

预览当前控件 + 可拖 “Available Controls”。提示 “Drag controls to reorder or move between areas.” Reset to Defaults。Editor / Terminal 应用下拉。检测中 “Detecting installed apps...”。空槽 “No controls in the top bar…”

控件显示名：GitHub Desktop、Editor、Terminal、Pull Request。编辑器/终端选项见 `messages/en.json` 的 `topbar*`。

### 12.6 About

应用图标、描述 “The Vibe Coding Workstation — …”、可点复制的 Version 徽章、维护者 AkaraChen（头像+主维护说明）、Repository / Releases / Website 外链。更新卡片：Check for Updates、Accept Beta Updates 开关、有更新则 Install {version}。状态文案见 i18n `update*`。

---

## 13. 全部对话框目录

凡未写尺寸的，都用 §3.5 标准小对话框。

### 13.1 Create Project

触发：侧栏 `+`。

- 标题：FolderPlus + “Create Project”
- **未选文件夹：** 虚线大按钮，Folder 24px + “Choose Folder”，hover muted
- **已选：** 上 “Folder” + xs “Choose Folder” 铅笔；下 code 块显示路径
- Project Name 输入，占位 “Optional. Leave empty to use folder name”
- 说明随状态变三条 hint（先选文件夹 / 只用文件夹名 / 自定义名）
- Footer：Cancel / Create（无文件夹或进行中禁用；进行中出 Spinner）
- 选文件夹用系统目录对话框；若名为空则填 basename
- 成功关窗并导航到新项目第一个 Profile
- Enter 在名称框提交

### 13.2 Delete Project

触发：项目右键。

- Trash + “Delete Project”
- “Are you sure you want to delete this project? This action cannot be undone.”
- Cancel / Delete（红，进行中 Spinner）
- 若删的是当前项目：跳到列表里相邻项目的默认 Profile，否则回 `/`

### 13.3 Rename Project

触发：项目右键。打开时 focus 输入。

- Pencil + “Rename”
- “New Name”
- Cancel / Rename（空或未改禁用）

### 13.4 Project Settings

触发：项目右键或顶栏齿轮。

- Gear + “Project Settings”
- 内 Tabs：**Scripts**（Code 图标）/ **Templates**（终端窗图标）
- Scripts：Worktree Directory + Init / Setup / Teardown 三个等宽 textarea（4 行，占位 “One command per line…”）
- Templates：项目级终端模板编辑器（与全局同构）
- Cancel / Save（进行中 Spinner）
- 加载失败：DialogBodyError

### 13.5 Create Profile

触发：项目行 `+` 或子列表 “New Profile”。

- GitBranch + “New Profile”
- Branch Name，占位说明可留空自动生成 `pr/tokyo-a1b2c3d4` 这类名
- Cancel / Create → 导航到新 Profile

### 13.6 Delete Profile

触发：非默认 Profile 右键。

- Trash + “Delete Profile”
- 确认 worktree 会删
- 检查中：Spinner + “Checking this profile's Git status…”
- 有风险：Alert “Check Git changes before deleting” + 未提交/未推送/合计 diff 数字
- 检查失败：另一 Alert，请手动确认
- 主按钮在有风险时改成 “Delete Anyway”
- 删当前 Profile 则回默认/其它 Profile 或 `/`

### 13.7 Close Unsaved File

- Warning + “Close Unsaved File?”
- “{file} has unsaved changes. Closing it will discard those changes.”
- Cancel / Discard Changes（红）

### 13.8 Switch Branch

- GitBranch + “Switch branch”
- 搜索框 “Search branches…”
- 列表行：图标 + 名 + 徽章 current/trunk/used + ↑ahead ↓behind
- current / used 禁用；used 琥珀徽章（已被其它 Profile 占用）
- 当前行 muted 底；其它 hover
- 空：“No branches found”
- 成功 Toast “Switched to {branch}”；失败 “Checkout failed”

### 13.9 终端相关

- Open Link 确认
- Choose File（歧义路径）
- 模板草稿编辑（名、shell、cwd、命令）

### 13.10 Git Review Queue

从 Diff 对话框打开。标题 “Review Queue”。复制 / 复制并清空。Toast “Review comments copied”。

### 13.11 Debug Log

设置里打开 Debug Mode 后，主窗右下 **扳手圆钮**（`fixed right-16 bottom-4 z-50`）。点开日志对话框：搜索 “Search logs...”、Clear、自动滚、空 “No log entries yet”。`Cmd/Ctrl+Shift+D` 切换面板。

---

## 14. 叠加层与全局反馈

| 层 | z / 位置 | 内容 |
|----|----------|------|
| 命令面板遮罩 | 1400 | 40% 黑 |
| 命令面板 | 1401 | 见 §10 |
| 对话框 | 50 | 见 §3.5 |
| 菜单/tooltip | popover | 圆角 8、阴影、细环 |
| Toast | Sonner 默认 | 见 §3.6 |
| 调试 FAB | 50，右下偏左 | 仅 debug 开 |
| 新手引导 | driver.js | 见 §5 |
| 启动更新 | Toast 12s | 见 §2.4 |

侧栏 Home 的 onboarding 锚在 `#add-project-button`，不在 Home DOM 里。

---

## 15. 键盘一览

| 快捷键 | 范围 | 动作 |
|--------|------|------|
| `Cmd/Ctrl+,` | 全局 | 开设置窗 |
| `Cmd/Ctrl+Shift+D` | 全局 | 开/关调试面板 |
| `Cmd/Ctrl+K` | 活动 Profile | 命令面板 |
| `Cmd/Ctrl+T` | 活动 Profile | 新终端 |
| `Cmd/Ctrl+W` | 活动 Profile | 关当前终端 |
| `Cmd/Ctrl+E` | 活动 Profile | 开关次级侧栏 |
| `Cmd/Ctrl+G` | 活动 Profile | 开 Git Diff |
| `Cmd/Ctrl+S` | 文件查看器可见 | 保存 |
| `Cmd/Ctrl+Enter` | Commit 摘要/正文 | 提交 |
| `Enter` / `Shift+Enter` | 终端搜索 | 下/上一个匹配 |
| `Esc` | 搜索/多数对话框 | 关闭 |
| `↑` `↓` | 应用侧栏 | 项目/Profile 间移动焦点 |
| `←` `→` / Home / End | resize 热区 | 调宽度 |
| `Enter` / `Space` | 分组/部分动作 | 切换 |

macOS 用 Meta，其它用 Ctrl。TerminalLayer 的 T/W 当前实现检查 `metaKey`（macOS 路径）。

---

## 16. 平台差异（必须实现）

| | macOS | Windows | Linux |
|--|-------|---------|-------|
| 标题栏 | Overlay + 红绿灯 (16,24) | Overlay + 自定义 min/max/close | Overlay，无自定义按钮 |
| 侧栏 header padding-top | 32px | 8px | 8px |
| 侧栏折叠后顶栏 padding-left | 84px | 正常 | 正常 |
| 顶栏 padding-right | 20px | 118px | 20px |
| Reveal 文案 | “Reveal in Finder” | 同一 i18n key，实现应走系统文件管理器 | 同左 |
| 字体列表 | core-text | fontdb | fontdb |
| 系统音 | /System/Library/Sounds + afplay | C:\Windows\Media + PowerShell | XDG + 桌面播放器 |
| 顶栏外开 App | 探测本机已装的编辑器/终端/GitHub Desktop | 同 | 同 |

---

## 17. 持久化（影响 UI 还原）

| Store / key | 影响的 UI |
|-------------|-----------|
| `app-sidebar-width` | 侧栏宽、折叠、分组折叠 |
| `file-tree-panel` | 次级侧栏宽 |
| themeStore | 亮/暗/系统 |
| terminalSettingsStore | 字体、字号、主题、shell |
| notificationStore | 通知开关、声音 |
| sidebarSettingsStore | 是否显示项目头像 |
| topbar store | 控件顺序、编辑器/终端选择 |
| updater settings | 是否收 beta |
| debugStore | 调试是否启用（FAB 显隐） |
| locale | en / zh |

设置窗与主窗必须共用这些值（跨窗 sync）。

---

## 18. 硬编码、未走 i18n 的字（重写时建议补）

| 位置 | 字符串 |
|------|--------|
| 侧栏品牌 | `2Code` |
| 应用侧栏 resize aria | `Resize sidebar`（次级侧栏已 i18n） |
| 模板分裂按钮 | `Choose template` |
| Git Diff 关 | `Close` |
| Git 无分支时 | `main` |
| 文件树草稿名 | `New File` / `New Folder` |
| 预览失败 | `Preview unavailable` |
| 预览条 | `Preview` / `Office Preview` |
| 压缩包统计 | `{n} files / {m} folders` |
| 完成点 | `Dismiss completion notification` |
| 关标签 | `Close {title}` |
| Windows 按钮 | Minimize / Restore / Maximize / Close |
| 设置窗 title | `Settings` |
| 链接占位 | `https://` |
| About 作者 | `AkaraChen`、仓库 URL |

中文包在 `messages/zh.json`，key 与 `en.json` 对齐。重写时不要把英文写死进布局，除上表。

---

## 19. 完整组件树（实现对照）

```
[主窗口]
App
├── StartupUpdateCheck
├── AppSidebar
│   ├── Header: "2Code" + collapse
│   ├── Home? | Pinned[] | Projects[ Group | Project ]
│   │   └── Project
│   │       ├── Avatar + name + (+|caret|agent-dot)
│   │       ├── context: group / settings / rename / delete
│   │       └── sub: Default, Profile…, New Profile
│   ├── Footer: Settings
│   ├── resize
│   └── CreateProjectDialog
├── main
│   ├── HomePage | (empty ProjectDetailPage)
│   └── TerminalLayer
│       └── per profile (display none unless active)
│           └── ProfileLayout
│               ├── CommandPalette
│               ├── ProjectTopBar
│               │   ├── expand sidebar?
│               │   ├── Files | Git+stats | Notes
│               │   ├── project name + branch → SwitchBranchDialog
│               │   ├── topbar controls + project settings
│               │   └── GitDiffDialog
│               ├── ProfileSidebar
│               │   ├── FileTreePanel
│               │   ├── SidebarGitPanel → CommitComposer + ChangesFileList
│               │   └── ProfileNotesEditor → MarkdownEditor
│               └── TerminalTabs
│                   ├── terminal tabs + file tabs + New Terminal menu
│                   ├── FileViewerPane (Monaco | Markdown | preview)
│                   ├── Terminal… (xterm, search, link dialogs)
│                   └── UnsavedFileCloseDialog
├── DebugFloat → DebugLogDialog
└── WindowControls?

[设置窗口]
SettingsWindow → SettingsPage
├── General | Terminal+Preview | Templates | Notification | Top Bar | About
```

---

## 20. 重写验收清单

做完新 UI 后，对照下列是否 **看起来和用起来** 一样（不必同技术栈）：

1. 冷启动无项目：左栏只有 Home + Settings，右栏 Home 空态，引导指向 `+`。
2. 建项目：虚线选文件夹 → 命名 → 进入默认 Profile 空终端 CTA。
3. 开终端：标签出现，xterm 铺满；再开一个；切换不丢滚动/进程。
4. 切到另一 Profile 再切回：终端还在。
5. 文件树开文件：标签出现；md 走工具条编辑器；图走棋盘预览；脏点；关时确认。
6. Cmd+K 搜文件打开。
7. 次级侧栏 Files/Git/Notes 切换，Git 显示 +/-，Notes 能写能存。
8. Cmd+G 大 Diff：Changes 提交/推送，History 看提交，Unified/Split。
9. 顶栏点项目名开 Finder；点分支切换；齿轮开项目脚本/模板。
10. 侧栏钉选、分组、拖拽排序、折叠整栏、拖宽。
11. Cmd+, 独立设置窗；改主题/字体/圆角/头像，主窗立刻变。
12. Debug 开后右下扳手出日志。
13. 有更新时 Toast 12s，动作进 About。
14. Windows 右上三按钮可用；macOS 红绿灯不被标题挡住。
15. 中英切换，布局不碎。

---

## 21. 附录索引

需要像素级 className、token 表、完整 i18n key 列表时打开：

1. [sidebar-ui-inventory.md](./sidebar-ui-inventory.md)
2. [ui-inventory-home-project.md](./ui-inventory-home-project.md)
3. [ui-inventory-settings-terminal-git-debug-updater.md](./ui-inventory-settings-terminal-git-debug-updater.md)
4. 文案源：[`messages/en.json`](../messages/en.json) / [`messages/zh.json`](../messages/zh.json)
5. 颜色与全局 CSS：[`src/app.css`](../src/app.css)
6. 窗口配置：[`src-tauri/tauri.conf.json`](../src-tauri/tauri.conf.json)
