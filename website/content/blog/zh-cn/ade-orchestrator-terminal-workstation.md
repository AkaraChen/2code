---
title: "ADE、Orchestrator、终端工作站：三种工具，三种用法"
description: "Orca、JetBrains Air、Superset 都在解并行 Agent，但它们不是同一个产品。一张诚实的选型表：什么时候该选 ADE，什么时候该选编排器，什么时候该选终端工作站——包括 2code 不是答案的那几种情况。"
date: 2026-08-04
publishAt: 2026-08-04T00:00:00+08:00
slug: ade-orchestrator-terminal-workstation
tags:
  [
    Orca,
    Orca 替代,
    Superset,
    Superset 替代,
    JetBrains Air,
    ADE,
    agentic development environment,
    agent orchestration,
    Agentic IDE,
    并行 Agent,
    parallel coding agents,
    git worktree,
    Claude Code,
    Codex,
    终端工作站,
  ]
---

## 这个赛道所有人都在回答同样的四个问题

把 Orca、JetBrains Air、Superset 和 2code 的官网并排打开，你会发现词汇重合得厉害。四家的底座，是同样四条判断：

1. **并行。** 一次只跑一个 agent，早就不是值得优化的场景了。
2. **隔离。** 两个 agent 共用一份工作副本，一定互相踩脚。所以每个任务给一个 worktree、一个容器、一个独立工作区。
3. **自带 Agent。** 这一圈没有一家在卖模型。Claude Code、Codex、Gemini CLI，你已经在付费的那个 CLI agent，接进来就是。
4. **Review 优先。** 写代码那一步已经不是瓶颈了，判断要不要合才是。

所以品类共识早就定了。**没定的是屏幕中央放什么**——而这恰恰是这几个产品的全部差别。它决定了什么东西离你一次点击，什么东西离你三次点击，以及这个工具到底是为哪一种「一天」设计的。

这篇是选型表，不是打分表。我做 2code，立场明摆着。我能想到的唯一诚实做法，是把「答案不是 2code」的情况写清楚——这样的情况有好几种。

## 四种隐喻

**Orca——舰队。** Orca 自称 ADE（Agent Development Environment），它的基本单元是任务：*"Every task gets its own git worktree, its own agent terminal, and its own browser tab."* 整个画面是一个指挥官在看舰队：三个 agent 同时修一个 bug 然后挑赢家，手机上遥控，把活推到 SSH 目标上跑。它的文档在讲边界这件事上格外克制——*"Not a model… Not a git replacement… Not a hosted VPS product"*——而且是真开源，社区规模也在那儿。如果你想到「AI 编程」时，脑子里的画面就是一整墙并行任务由你调度，Orca 已经把它做出来了。

**JetBrains Air——可控。** Air 也自称 ADE，但重音落在另一个词上：*multitask with agents, **stay in control***。它那句我一直记着的话是：IDE 是往编辑器上加工具，Air 是围绕 agent 造工具。它给的隔离选项，正是企业会问的那三种——本地工作区、git worktree、Docker——再加上 JetBrains 二十六年的交互积累，和一套 team lead 能向上汇报的采购叙事。它真正的强项是信任感，这东西小工具抄不来。

**Superset——编排器。** Superset 自己的核心论点就是：你不需要更好的 agent，你需要一个编排器。它把自己定义成 *"the workspace and orchestration layer the agents run in"*，目标是 *"run 10+ parallel coding agents on your machine"*，每个 agent 一个独立 worktree。它的内容运营是这个赛道里做得最好的：那几篇 worktree 深度文和「通向 100 agents」的路线图，哪怕你不装它也值得读。它诚实的终点是 software factory——几十个 agent、一个中心看板、review 变成流水线上的一道工序。

**2code——终端工作站。** 中心不一样。不是舰队，不是编排层，也不是围绕 agent 重建的编辑器，而是**一个你能待一整天的终端**。2code 首先是个完整的终端模拟器——你的 shell、prompt、别名、CLI agent 全部照常工作——然后才往上叠普通终端根本不管的那几件事：这个窗口属于哪个项目哪个 worktree、里面那个 agent 是在跑还是在等你、明天早上打开时这一切还在不在。

四句话总结：

| 产品 | 屏幕中央是什么 | 隐含的使用者 |
| --- | --- | --- |
| Orca | 任务舰队 | 同时指挥很多条线、经常不在电脑前的人 |
| JetBrains Air | Agent 的任务循环，人仍在掌控里 | 团队里需要为工具做说明的工程师 |
| Superset | 编排层 | 正在往几十个 agent 规模上走的人 |
| **2code** | **终端** | **一天本来就发生在终端里的人** |

## 按你真实的一周选，不要按演示视频选

演示视频里的 agent 数量，永远比你实际跑的多。所以别看演示，回答这个问题：**过去一周，你真正同时开着几个 agent，坏掉的是哪一环？**

| 你想要… | 更接近 |
| --- | --- |
| 同时管很多 CLI Agent、让它们赛跑挑赢家、手机遥控 | **Orca** |
| JetBrains 生态、Docker 隔离、全程可控、有企业叙事 | **JetBrains Air** |
| 大规模并行、一层编排、完整的 compare 与 review 流水线 | **Superset** |
| 每天以终端为主、两到五条线、少丢状态、worktree 分得清 | **2code** |

这个赛道最大的陷阱，是把 agent 数量当分数。十个并发对少数人是真实工作流，对大多数人是 cosplay。如果你诚实的数字是三，那么一个为一百个 agent 设计的工具，会把界面预算花在你没有的问题上；而你真正有的那个问题——通常就是「这三个哪个跑完了、diff 在哪」——谁把它放在中央，谁就解得掉。

## 真正有差别的几个维度

| | Orca | JetBrains Air | Superset | 2code |
| --- | --- | --- | --- | --- |
| 隔离方式 | 每任务一个 worktree | 本地 / worktree / Docker | 每 agent 一个 worktree | Worktree profile，带 setup/teardown 脚本 |
| 中心 UI | 任务泳道 | Agent 循环 | 编排看板 | 终端 |
| 自带 Agent | 支持 | Codex、Claude Agent、Gemini CLI、Junie | 支持 | 支持——能在 shell 里跑的都行 |
| 退出后的状态 | 按 workspace 保留 | 按任务保留 | 按任务保留 | 会话、scrollback、窗口布局一起恢复 |
| 移动端 / 远程 | 手机 companion、SSH 目标 | — | — | — |
| 授权 | 开源 | JetBrains 订阅或 BYOK | Source-available（ELv2） | 开源 |
| 平台 | 桌面，跨平台 | JetBrains 支持的桌面平台 | macOS（Windows/Linux 官网称即将支持） | macOS 为主；Windows/Linux 实验性 |

关于我自己这一列，两句实话。「移动端 / 远程：—」不是路线图暗示，就是没有。「macOS 为主」的意思是：另外两个平台的构建确实存在，但我还不好意思请你依赖它。

## 2code 不是答案的那几种情况

最快失去你信任的方式，就是宣称自己样样都赢。所以：

**你要的是百 Agent 工厂。** 2code 没有调度器、没有任务队列、没有自动 review 关卡。Superset 是有意在建这一层，而且走得远得多。我们做的是工作台，而工作台的上限，就是一个人脑子里装得下的线数。

**你需要 Docker 或完整沙箱隔离。** 2code 用 git worktree 做隔离。这个量级对日常并行刚好，对不可信代码、或要求每任务独立容器环境的场景，就太轻了。Air 的隔离菜单比我们宽。

**你想用手机遥控，或者让 agent 跑在远端机器上。** Orca 就是为这种一天设计的，2code 不是。

**你不用 macOS。** Windows 和 Linux 构建有，但是实验性的。如果你今天在这两个平台上，建议再等等。

**你想要一个完整 IDE。** 2code 有轻量编辑器和内置 git diff，够你走完 review 那一遍。它不是 IntelliJ，也不打算是——你会把编辑器开在它旁边，这本来就是设计里的用法。

去掉这些之后，剩下的主张很窄，而这正是重点：**2code 是给那种一天本来就在终端里、同时跑几个而不是一群 agent、真实痛点是「跟丢了」的开发者用的。** 一个 worktree 一个窗口，agent 跑完亮绿点响一声，重启之后这一切还立在那儿。

如果这不是你的一天，上面那三家里总有一个更合适。我宁愿你去装那个，也不想你在我这儿撞一鼻子灰。

## 试一下

如果你会说出口的那句话是「我不需要指挥舰队，我只需要我这三条线别再变成三个黑盒」——

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/>（[中文](https://2code.akr.moe/zh-cn)）
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>

同一个赛道，四种关于「屏幕中央该放什么」的不同下注。挑那个和你真实的一天对得上的。
