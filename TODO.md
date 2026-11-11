# TODO：herdr 版 2code 与旧版（Tauri）的差距

旧版代码在 [`legacy-tauri-app`](https://github.com/AkaraChen/2code/tree/legacy-tauri-app) 分支。已经实现的功能见 [README](README.md)，实现细节见 [RECIPE](RECIPE.md)。

旧版的功能都已迁移完，或者已确认砍掉。下面只列还没完成的事、做不了的事，以及和旧版不一样的地方。

## 一、需要仓库所有者处理

这三件事超出了我这边能执行的权限，需要你来做：

- [ ] **把官网发布出去。** 线上站点仍由 Netlify 从 `dev` 构建：线上有只存在于 `dev` 的页面，内容还是桌面版。两种做法任选其一：
  - 合并 [#494](https://github.com/AkaraChen/2code/pull/494)。它把已停用的 `dev` 快进到一个内容和 `main` 完全一致的合并提交，不是强推，`dev` 的历史全部保留。
  - 或者在 Netlify 后台把生产分支改成 `main`，然后关闭 #494。
- [ ] **关闭 Dependabot PR #477–#486。** 它们已经自动改成指向 `main`，升级的是 `src-tauri/`、`e2e-tests/` 里的依赖，而这两个目录已经不存在了。我这边关闭被权限拦下，需要你手动关闭。
- [ ] （可选）在 GitHub Releases 上给旧桌面版用户发迁移公告。旧版的自动更新会读取“latest” release 里的 `latest.json`，所以新 release 不要标成 latest，否则旧版检查更新时会失败。

许可证：作者名下的其他仓库都没有 LICENSE 文件，这次也按惯例没有加。如果希望别人能合法复用 2code 的代码，需要补一个。借用的第三方代码已经在 `mods/2code/NOTICE` 中注明：Herdr 的 mod（Apache-2.0）、Lucide 图标（ISC）、material-icon-theme（MIT）。

## 二、受 Herdr 限制，做不了或只能做一部分

- agent 状态检测：旧版 19 套屏幕文字识别规则用不上了，herdr-core 只认程序自己发的 OSC 7501。不上报状态的 agent 不会显示状态点。
- 终端链接由 Herdr 自己处理，Ctrl/⌘+点击直接用系统默认程序打开。旧版的“选择用哪个浏览器打开”，以及 `路径:行:列` 在 2code 编辑器里打开，都做不到，因为 mod 拿不到链接点击事件。
- 字号：⌘= / ⌘- 是 Herdr 的整体缩放（界面和终端一起），不能只缩放终端。
- PDF、Office、压缩包预览：没有 WebView，做不了。
- 编辑器用的是 Herdr 内置的 Editor：
  - 文件最大 1 MiB；
  - 没有查找替换、没有跳转到行、没有 LSP；
  - TypeScript 只能按 JS 高亮。
- 未保存提示只拦得住 2code 自己 tab 上的 ×。用 Herdr 的方式关闭（⌘W、菜单）不会提示，改动会存成恢复副本，下次打开该文件时可以恢复。
- Herdr 自己的界面（设置页、worktree 对话框、toast）只有英文。
- Diff 里的 Shift 扩选：虚拟列表的点击事件不带修饰键，所以加了“点一行再点另一行选中一段”作为兜底。
- 回收站：没有回收站的挂载点（比如 `/tmp`）无法移到回收站，对话框会说明原因，并提供“永久删除”。
- Intel Mac：Herdr 只发布 Apple Silicon 版，Intel Mac 需要自己从源码编译。
- 2code layout 本身不会自动更新（Herdr 本体会），更新 layout 要重新安装。

## 三、和旧版不一样、目前接受的行为

- 新建 profile：
  - 没有拼音分支名，也不再自动起名（`pr/<city>-xxxx`）；
  - worktree 固定放在 `~/.herdr/worktrees/<仓库>/<分支>`，`worktree_dir` 不再生效。
- 删除 profile：
  - 分支会保留，不再删除；
  - 如果从 Herdr 自己的菜单删除，不会执行 `teardown_script`。
- `init_script` 只在三种情况下执行：2code 的“新建终端”、模板、⌘T / Ctrl+Shift+T。用 Herdr 其他方式开的终端不会执行。
- 一个打开的 profile 至少要有一个 tab。关掉最后一个 tab，它对应的 space 也会关掉，profile 在侧栏里变成“未打开”状态。
- 没有首页，也没有首次使用引导。
- 顶栏按钮不能再自定义排序和显示/隐藏，换成了一个“用…打开”下拉菜单。
- 设置统一用 Herdr 的设置页（字体、主题、提示音、默认 shell）。语言只跟随系统环境变量 `LC_ALL` / `LC_MESSAGES` / `LANG`，没有切换器。
- 快捷键：
  - Linux / Windows 上 2code 原来的 Ctrl+K / G / E 改成了 Ctrl+Shift 组合；
  - 在 2code layout 里，Ctrl+Shift+E 盖掉了 Herdr 的“向下分屏”，Ctrl+Shift+K 盖掉了 Herdr 的 picker；
  - Linux 上 Alt+←/→ 盖掉了 Herdr 的 pane 切换；
  - 安装时会改动用户的 `keys.json`，改动后 Herdr 不再自动更新其中的默认快捷键。
- 全局配置放在 `~/2code/2code.json`（不是隐藏目录）。

## 四、待验证（只在 Linux + Xvfb 下测过）

已验证：中文环境（`LANG=zh_CN.UTF-8`）和深色主题 `2code-dark`。

- [ ] macOS 真机：
  - [ ] 红绿灯和左上角品牌区的位置；
  - [ ] 在 Finder 中显示、用默认应用打开、`/usr/bin/trash`；
  - [ ] “用…打开”能否找到 `/Applications` 下的应用；
  - [ ] 登录 shell 没有设置 `LANG` 时，回退到英文是否符合预期。
- [ ] 真机上 Shift 扩选能不能用。
- [ ] Windows：setup、teardown、模板都依赖 `sh`；“在文件管理器中显示”走 `explorer.exe`，回收站走 PowerShell。
- [ ] 远程机器（Herdr 的 machine）上的项目：
  - [ ] 新建和删除 profile；
  - [ ] 模板（用 `hc send` 输入命令）；
  - [ ] Changes 和 Diff 对话框；
  - [ ] 远程文件以只读方式打开；
  - [ ] 项目设置在远程项目上是只读的。
