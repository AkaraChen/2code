# TODO：herdr 版 2code 与旧版（Tauri）的差距

旧版代码在 [`legacy-tauri-app`](https://github.com/AkaraChen/2code/tree/legacy-tauri-app) 分支。已经实现的功能见 [README](README.md)，实现细节见 [RECIPE](RECIPE.md)。

## 一、计划要做，还没做（文件部分）

- [ ] 编辑器面板：多 tab，⌘S / Ctrl+S 保存，未保存标记，文件被外部修改时提示，未保存时写恢复副本。用 herdr 内置的 `Editor`，参考 agentee-editor（Apache-2.0）。
- [ ] 文件树显示文件图标（Material icon theme，MIT，需随附许可证）。
- [ ] 文件树右键菜单：打开、用默认应用打开、在文件管理器中显示、新建文件或文件夹、重命名、删除、复制相对或绝对路径、刷新。
- [ ] 文件树里被 gitignore 的文件调暗显示（社区实现里都没有这个）。
- [ ] 每个 profile 记住打开过的文件 tab。
- [ ] Markdown 预览，支持编辑 / 分栏 / 预览三种模式。
- [ ] 图片预览。
- [ ] ⌘K / Ctrl+Shift+K 模糊查找文件（弹出层，`git ls-files` 加模糊匹配），在 `keys.json` 里补上绑定。
- [ ] 终端里的 `路径:行:列` 链接没法在 2code 编辑器里打开（见第三节），编辑器做好后再看有没有替代入口。

## 二、仓库和发布的收尾

- [ ] 合并 PR #487 到 `main`。
- [ ] 把 Netlify 的生产分支从 `dev` 改成 `main`（需要在 Netlify 后台操作）。
- [ ] 改写官网文案：安装步骤还在介绍桌面版（brew、DMG），要改成先装 Herdr 再装 layout。
- [ ] 关闭 `dev` 上已经没用的依赖升级 PR（#477–#486）。`dev` 分支本身保留，已不再使用。
- [ ] 给旧桌面版用户一个迁移说明：发一个最终版 release，或者在 release notes 里写明怎么迁到 Herdr。
- [ ] 决定仓库用什么许可证（目前没有 LICENSE 文件）。借用的 Apache-2.0 / MIT 代码已经在 `mods/2code/NOTICE` 里注明。
- [ ] 合并后给仓库加上 GitHub topic `herdr-layout`，让它出现在 herdr.dev/layouts。

## 三、受 Herdr 限制，做不了或只能做一部分

- agent 状态检测：旧版 19 套屏幕文字识别规则用不上了，herdr-core 只认程序自己发的 OSC 7501。不上报状态的 agent 不会显示状态点。
- 终端链接由 Herdr 自己处理，Ctrl/⌘+点击直接用系统默认程序打开。旧版的“选择用哪个浏览器打开”确认框，以及 `路径:行:列` 在 2code 编辑器里打开，都做不到，因为 mod 拿不到链接点击事件。
- 字号：⌘= / ⌘- 是 Herdr 的整体缩放（界面和终端一起），不能只缩放终端。
- PDF、Office、压缩包预览：没有 WebView，做不了。
- 编辑器的能力上限（等第一节做完后适用）：
  - 文件最大 1 MiB；
  - 没有查找替换、没有跳转到行、没有 LSP；
  - TypeScript 只能按 JS 高亮。
- 未保存提示只拦得住 2code 自己的关闭操作。Herdr 关闭面板时不通知 mod，只能写恢复副本。
- Herdr 自己的界面（设置页、worktree 对话框、toast）只有英文。
- Diff 里的 Shift 扩选：虚拟列表的点击事件不带修饰键，所以加了“点一行再点另一行选中一段”作为兜底。
- Intel Mac：Herdr 只发布 Apple Silicon 版，Intel Mac 需要自己从源码编译。
- 2code layout 本身不会自动更新（Herdr 本体会），更新 layout 要重新安装。

## 四、和旧版不一样、目前接受的行为

- 新建 profile：
  - 没有拼音分支名，也不再自动起名（`pr/<city>-xxxx`）；
  - worktree 固定放在 `~/.herdr/worktrees/<仓库>/<分支>`，`worktree_dir` 不再生效。
- 删除 profile：
  - 分支会保留，不再删除；
  - 如果从 Herdr 自己的菜单删除，不会执行 `teardown_script`。
- `init_script` 只在三种情况下执行：2code 的“新建终端”、模板、⌘T / Ctrl+Shift+T。用 Herdr 其他方式开的终端不会执行。
- 一个打开的 profile 至少要有一个终端。关掉最后一个 tab，它对应的 space 也会关掉，profile 在侧栏里变成“未打开”状态，worktree 仍在磁盘上。
- 没有首页，也没有首次使用引导。
- 顶栏按钮不能再自定义排序和显示/隐藏，换成了一个“用…打开”下拉菜单。
- 设置统一用 Herdr 的设置页（字体、主题、提示音、默认 shell）。语言只跟随系统环境变量 `LC_ALL` / `LC_MESSAGES` / `LANG`，没有切换器。
- 快捷键：
  - Linux / Windows 上 2code 原来的 Ctrl+K / G / E 改成了 Ctrl+Shift 组合；
  - 在 2code layout 里，Ctrl+Shift+E 盖掉了 Herdr 的“向下分屏”；
  - Linux 上 Alt+←/→ 盖掉了 Herdr 的 pane 切换；
  - 安装时会改动用户的 `keys.json`，改动后 Herdr 不再自动更新其中的默认快捷键。
- 全局配置放在 `~/2code/2code.json`（不是隐藏目录）。

## 五、已经确认砍掉

项目分组、置顶、拖拽排序；Profile Notes（Milkdown）；回放式会话恢复（Herdr 的终端本来就常驻）；设置里的圆角、调试模式、性能分析、头像开关、beta 通道；调试面板；自动更新器；9 套终端主题（只保留 2code-light / 2code-dark）；从文件树拖文件到终端；系统通知（改用 Herdr 自带的提醒）；数据库及其数据迁移。

## 六、待验证（目前只在 Linux + Xvfb 下测过）

- [ ] macOS 真机：
  - [ ] 红绿灯位置 `[16, 24]` 是否和侧栏标题重叠；
  - [ ] 在 Finder 中显示（`open`）；
  - [ ] “用…打开”能否找到 `/Applications` 下的应用；
  - [ ] 登录 shell 没有设置 `LANG` 时，语言回退到英文是否符合预期。
- [ ] 中文环境（`LANG=zh_CN.UTF-8`）下，所有 2code 文案是否都显示中文。
- [ ] 真机上 Shift 扩选能不能用。
- [ ] 深色主题 `2code-dark` 的整体观感（还没有截图核对过）。
- [ ] Windows：setup、teardown、模板都依赖 `sh`；“在文件管理器中显示”走 `explorer.exe`。
- [ ] 远程机器（Herdr 的 machine）上的项目：
  - [ ] 新建和删除 profile；
  - [ ] 模板（用 `hc send` 输入命令）；
  - [ ] Changes 和 Diff 对话框；
  - [ ] 项目设置在远程项目上是只读的。
