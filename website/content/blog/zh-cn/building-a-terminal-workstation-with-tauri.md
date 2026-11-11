---
title: 我们如何用 Tauri 做终端工作站
description: 2code 的栈是 Tauri 2 + React 19 + Rust workspace + xterm.js。这篇讲清四个 crate 的分工、终端 tab 永不卸载的三层防护、PTY 输出为什么从 SQLite 搬进文件，以及 Windows 上踩过的坑。
date: 2026-08-06
publishAt: 2026-08-06T09:00:00+08:00
slug: building-a-terminal-workstation-with-tauri
tags:
  [
    Tauri,
    Tauri 2,
    Rust,
    Electron,
    xterm.js,
    PTY,
    终端模拟器,
    React,
    开源,
    git worktree,
    终端工作站,
  ]
---

2code 是一个开源的桌面终端工作站：终端、AI CLI agent、git、worktree 泳道待在同一个 App 里。这篇是它的工程解剖——技术栈怎么选的，终端这层最难的三个问题怎么解的，哪些地方还在踩坑。所有提到的路径都能点进[仓库](https://github.com/AkaraChen/2code)对照着看。

## 先看模块边界

```text
┌─────────────────────────────────────────────────┐
│ 前端 src/（React 19 + xterm.js）                 │
│   features/terminal — 渲染、agent 检测、tab 状态 │
├─────────────────────────────────────────────────┤
│ IPC：#[tauri::command] + Channel<&[u8]>          │
│   src-tauri/src/handler — 七十来个命令入口       │
│   src-tauri/src/bridge  — service trait 的实现   │
├─────────────────────────────────────────────────┤
│ Rust workspace（src-tauri/crates/）              │
│   service — 会话生命周期、读线程、泳道编排       │
│   infra   — PTY、git、日志文件、DB 初始化        │
│   repo    — Diesel CRUD                         │
│   model   — DTO、schema、错误类型                │
├─────────────────────────────────────────────────┤
│ 存储：app.db（SQLite，WAL）+ pty_logs/*.log      │
└─────────────────────────────────────────────────┘
```

三个值得展开的设计决定：

**service 不认识 Tauri。** [service crate](https://github.com/AkaraChen/2code/tree/dev/src-tauri/crates/service) 定义了 `PtyEventEmitter`、`WatchEventSender` 两个 trait，由 app 层的 `bridge.rs` 在 Tauri 侧实现。业务逻辑因此可以脱离桌面壳跑 `cargo test`，也让「哪一层能碰什么」在编译期就钉死了。

**DB 只存元数据。** projects、project_groups、profiles、pty_sessions 四张表，终端输出一个字节都不进 SQLite。为什么，后面有一个翻车故事专门讲。

**前端不手写 IPC client。** Rust 侧加完 command，跑 `cargo tauri-typegen generate`，`src/generated/` 自动更新。README 把「手写 API client」列为禁止事项，因为手写一定会和 Rust 签名漂移。

## 为什么是 Tauri，不是 Electron

先说清楚：这不是 benchmark 对比文，是我当时的选型理由。回头看，依然成立的有三条。

**一、这个 App 的重头在后端。** PTY 管理、git 子进程、文件监听、shell 注入脚本——2code 的 Rust 侧不是「给前端当 API」，它是一个真的系统程序。这一层用 Rust 写最顺：[portable-pty](https://crates.io/crates/portable-pty) 管伪终端，[notify](https://crates.io/crates/notify) 管文件监听，连 async runtime 都没请，tokio 只开了 `sync` feature 借个 channel，读线程就是朴素的 `std::thread`。如果用 Electron，这一层就得用 Node 写，然后绕回 node-pty 原生模块的编译和分发问题。选 Tauri，等于把最难的一层放进最擅长的语言。

**二、不打包 Chromium。** 用系统 webview，安装包和常驻内存都小一个量级。代价是「webview 差异税」：三个平台三种渲染内核，行为不完全一致。这个税我们真交过，踩坑一节细说。

**三、权限模型。** Tauri 2 的 [capabilities](https://github.com/AkaraChen/2code/blob/dev/src-tauri/capabilities/default.json) 可以把权限收窄到「只允许执行 `open` / `explorer` / `xdg-open`，且参数要过校验」。对一个本职工作是「替你起进程」的 App 来说，能把攻击面写进配置文件，是实际的安全收益。

IPC 层还有个顺手的点：终端输出走 Tauri 的 `Channel`，每个会话一条独立的字节流，不用在事件总线上自己拼多路复用。

## 难点一：把 shell 老老实实塞进 PTY

spawn 一个 PTY 本身不难，portable-pty 十几行代码的事。真正麻烦的是 shell integration：我们想拿到「命令从哪开始、到哪结束、退出码多少、cwd 在哪」这些事件，标题栏和状态检测都靠它们。

做法是站在 VS Code 肩上。VS Code 的 [shell integration](https://code.visualstudio.com/docs/terminal/shell-integration) 脚本是 MIT 协议的，我们把它们嵌进二进制（[shell_init.rs](https://github.com/AkaraChen/2code/blob/dev/src-tauri/crates/infra/src/shell_init.rs)），按 shell 类型注入：bash 给 `--init-file`，zsh 换掉 `ZDOTDIR`，fish 用 `--init-command`，PowerShell 走 `-NoExit -Command`。再把 `TERM_PROGRAM` 设成 `vscode`，脚本就以为自己活在 VS Code 终端里，照常工作。2code 自己的初始化脚本保持极简，不装 agent wrapper，不动 PATH。

## 难点二：输出管道，为什么从 SQLite 搬进文件

这是我最喜欢讲的翻车故事。

最早的版本，终端输出是进 SQLite 的。后来 [2026-07-01 的一个 migration](https://github.com/AkaraChen/2code/tree/dev/src-tauri/migrations) 把 `pty_session_output` 整张表删了，输出改成写文件：`pty_logs/{session_id}.log`。

原因很物理。DB 是全局单连接（`Arc<Mutex<SqliteConnection>>`），一个话痨会话，比如 `cargo build` 刷屏，会把写事务排成长队，其他会话的元数据写入全部堵在锁后面。终端的写入量级和关系数据库的写入量级不是一个物种，硬塞在一起，锁就是单点。

现在的管道长这样：每个会话一个读线程，4 KB 一块读出来，兵分两路。一路经 `Channel<&[u8]>` 直推前端渲染；另一路过 channel 交给专门的持久化线程，攒够 32 KB 或 250 ms 落一次盘。前端和磁盘互不阻塞，DB 只在会话创建、改名、关闭时露面。

## 难点三：切 tab 不能丢会话

xterm.js 的实例一旦 unmount，canvas 状态就没了，再挂回来的是一个崭新的终端，滚动历史、进行中的 TUI 程序全废。所以 2code 有条铁律写在 [terminal 模块的 AGENTS.md](https://github.com/AkaraChen/2code/blob/dev/src/features/terminal/AGENTS.md) 里：**Never unmount terminals**。落地是三层防护：

1. **TerminalLayer**：所有泳道的终端渲染在一个常驻 overlay 里，不活跃的泳道 `display: none`。
2. **TerminalTabs**：同一泳道里的多个 tab 绝对定位叠放，不活跃的 `visibility: hidden`。
3. **停车**：React 19 的 ref cleanup 时序下，组件真的被卸载而 tab 还开着时，把 xterm 的 DOM 节点挪到屏幕外的 `#terminal-parking` 容器（`left/top: -9999px`），而不是 dispose。这个手法借自 VS Code 的 `setVisible(false)`。

配套细节：每次挂载生成新的 `stream_id`，上一次卸载留下的清理逻辑就不会把新流掐掉。

那重启 App 呢？会话毕竟是真的死了。恢复分冷热两路。热路在 Rust 侧：拿日志文件过一遍 [vt100](https://crates.io/crates/vt100) 模拟器，一万行 scrollback，剥掉 alternate screen（不然 vim 的残影会糊进历史），起一个新 PTY，把「现场」回放到屏幕上，session 表里换一条新记录。冷路在前端：每个会话在 localStorage 里缓存了 1000 行序列化结果，先秒开一个「看起来像」的终端，再和热历史做字节级 overlap 去重。

## Worktree 泳道：git 和 UI 各管一段

泳道（profile）的生命周期由 service crate 编排：`git worktree add -b` 建工作副本，落一行 `profiles` 表，然后在 worktree 里跑你在 `2code.json` 里写的 `setup_script`（比如 `bun i`）。路径有个小约定：`~/.2code/workspace/{项目}-{分支}-{8 位 id}`，分支名是中文就先转拼音；懒得想名字的，自动生成 `pr/{城市}-{8 位 hex}`，tokyo、osaka、seoul 轮着来。

删除反着来一遍：`teardown_script` → `git worktree remove --force` → `git branch -D` → DB 外键级联清掉会话记录。建和删都是全仓操作，不留半截状态。

`init_script` 走另一条路：它不进 worktree 流程，而是拼进每个新终端的 shell 注入里。你写在里面的环境变量和 alias，对该泳道所有终端生效。

UI 这边的状态协作主要是 agent 检测。一个纯前端的规则引擎，[detector/rules](https://github.com/AkaraChen/2code/tree/dev/src/features/terminal/detector/rules) 下目前有 18 个 agent 的规则清单：Claude Code、Codex、Gemini、Kimi……输入有三种——xterm 屏幕文本、OSC 窗口标题、OSC 9;4 进度序列，每 250 ms 跑一轮，把 working / blocked / idle 翻译成标签页上的绿点和提示音。这套机制的产品逻辑在[《Agent 跑完了，你怎么知道？》](/zh-cn/blog/how-do-you-know-your-agent-is-done)里讲过，泳道的日常用法在[《用 Worktree 当 Agent 工位》](/zh-cn/blog/worktree-as-agent-workstations)里，这篇只说实现位置。

## 踩坑与还在实验的部分

README 第一屏就写着 macOS 是主平台、Windows 和 Linux 是实验支持，这不是客套：

- **macOS WebKit 的字体度量有个坑。** xterm 用来量字符宽度的 canvas 如果没 attach 到 DOM，WebKit 返回的度量是错的，光标位置整体漂移。解法是 patch 掉它的测量面（[xtermMetricsPatch.ts](https://github.com/AkaraChen/2code/blob/dev/src/features/terminal/lib/xtermMetricsPatch.ts)）。这就是前面说的 webview 差异税，Electron 用户不用交，但交完也就这一次。
- **Windows 的脾气。** 没有原生窗口装饰，标题栏是前端自绘的；起子进程要过一道 `command_without_windows_console`，不然每跑一条命令闪一个黑窗；启动命令还得先睡一秒、发个 `\x1b[1;1R`、换行用 `\r`。ConPTY 的功课，做终端的都躲不掉。
- **Linux 的边角。** 声音提示走 canberra / paplay，字体枚举换 fontdb。CI 里唯一跨平台的守门员是一条 Ubuntu 24.04 + xvfb 的冒烟测试——至少保证 Linux 能起得来、开得了终端。

## 本地跑起来

```bash
git clone https://github.com/AkaraChen/2code.git
cd 2code
bun install
bun tauri dev      # 完整桌面 App，前后端热更新
```

其他常用命令：`bun run dev` 只起前端；`cd src-tauri && cargo test` 跑 Rust 测试；`just verify` 把 lint、类型检查、前后端测试一把跑完。改了 Rust command 记得 `cargo tauri-typegen generate` 重新生成前端绑定。

## 欢迎贡献的方向

仓库里暂时没有 CONTRIBUTING.md，但有几样东西比它管用：

- **[AGENTS.md 系列](https://github.com/AkaraChen/2code/blob/dev/AGENTS.md)**：根目录一份总图，terminal、src-tauri、handler、e2e 各有专题。名字是写给 coding agent 的，对人同样是最好的代码地图。
- **[openspec/specs](https://github.com/AkaraChen/2code/tree/dev/openspec/specs)**：13 份功能 spec，PTY 管理、终端 tab、泳道……改行为之前先读它。
- **[plans/](https://github.com/AkaraChen/2code/tree/dev/plans)**：一次性能审计留下的 28 个已确认优化方案，外加 5 个带 benchmark 的否决记录。想找 good first issue，这就是现成清单，每个方案自带测量数据。
- **[detector/rules](https://github.com/AkaraChen/2code/tree/dev/src/features/terminal/detector/rules)**：你常用的 agent 不在 18 个里面？加一个规则文件就是一次完整贡献。

Windows 和 Linux 的打磨也长期欢迎。实验支持的另一面，是到处都有够得着的问题。

## 最后

2code 开源在 GitHub：<https://github.com/AkaraChen/2code>，star、issue、PR 都欢迎。想先用起来：

```bash
brew install --cask akarachen/tap/2code
```
