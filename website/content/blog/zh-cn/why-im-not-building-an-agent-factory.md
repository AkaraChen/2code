---
title: 为什么我不先做「百 Agent 工厂」
description: Orca 说 Ship 100x，Superset 的目标是年底并行管理 100 个 agent。方向没错，但连他们自己现在也只稳定跑 5–7 个。作为独立开发者，我选择先把两三条泳道做顺——这是 2code 的取舍清单。
date: 2026-08-05
publishAt: 2026-08-05T09:00:00+08:00
slug: why-im-not-building-an-agent-factory
tags:
  [
    并行 Agent,
    agent orchestration,
    独立开发,
    产品取舍,
    Claude Code,
    终端工作站,
  ]
---

## 这一轮，大家都在喊数量

打开这一批工具的官网，标题几乎都在同一个方向上：

- Orca：**"Ship 100x With The Agent IDE"**，主打「a fleet of agents」，首页的用户证言是「Orchestrating 600 agents from my phone」。
- Superset：**"Run 10+ parallel coding agents on your machine"**，并且写了一篇路线图，目标是**年底每人并行管理 100 个 agent**。

我认真读了这些页面，也认真觉得这个方向是对的——agent 的边际成本确实在往下掉。Superset 那篇路线图里有句很清醒的话：*"Agent compute is already cheap enough, you can run hundreds of agents a month all for less than the cost of one engineer."*

所以这篇不是拆台。我只是要说清楚，作为一个独立开发者做工具，我**为什么不先做那一层**。

## 先看一个数字：连他们自己也只跑 5–7 个

还是 Superset 那篇路线图，它最诚实的地方在开头：

> *"Right now at Superset, we're able to reliably manage 5-7 coding agents in parallel... Our goal is to be able to manage 100 coding agents in parallel each by the end of 2026."*

> *"What's stopping us is every agent needs a human to review its code, give feedback, and decide what to work on next. Scale the agents all you want - it's the humans that don't scale."*

> *"Right now, most of our agents spend more time waiting for us to review their work than they spend doing it."*

也就是说：一家专门做并行编排的公司，今天的稳定并发是 **5–7**，而且它们的 agent **大部分时间在等人 review**。100 是目标，不是现状——他们自己就是这么写的。

那你呢？

别拍脑袋，去数一下。数你上周真正**同时在跑、并且你真的跟进到底**的任务线有几条。不是「我开过多少个终端窗口」，是「有几条线我最后真的看了 diff、做了决定」。

我自己数出来的量级是个位数，日常在 2 到 3 条之间，忙的时候多一两条。2code 就是照着这个量级设计的。

这里有个容易被忽略的事实：**并发数不是由模型能力决定的，是由你能消化多少 review 决定的**。一条线跑完，最后总要有个人扫一眼 diff、判断合不合。这一步不会因为你多起 90 个 agent 而变快——Superset 自己也是这么说的：「You can't review 100 diffs a day」。

所以「百 Agent 工厂」是一个团队级的、需要把 review 也自动化掉的目标。它很值得做。但它不是我今天要解决的问题。

## 真正拖后腿的四件事

如果我的真实并发只有两三条，那我每天的时间到底花在哪了？我列过一次，是这四件：

**一、恢复。** 关掉 App、重启一次电脑、第二天早上打开——那三条线还在吗？代码当然在，git 里都在。丢掉的是「哪条线在干嘛、跑到哪了、下一步是什么」。每次重启都要重新考古一遍，这个成本我每周要付好几次。

**二、通知。** Agent 跑完了，谁告诉我？没人的话，我就变成了轮询器：每两分钟切一圈窗口看看谁好了。三条线的轮询成本已经足够让我不敢离开桌子——而「让 agent 干活的时候我去干别的」本来才是并行的全部意义。

**三、review 的距离。** Agent 说改完了。从这句话到「我看清了 diff 并做了决定」中间隔着几次应用切换？终端 → 编辑器 → git GUI → 再切回来。这段路每天要走十几次。

**四、上下文切换。** 上面三件事叠起来，就是一天里被切碎的注意力。不是被 agent 切碎的，是被**工具之间的缝隙**切碎的。

注意这四件事有个共同点：**它们都跟你并行几条线没关系，跑一条线也一样疼。** 加到 100 条只会让它们更疼，但根源不在数量。

这就是我的判断：对独立开发者来说，先死的不是「我调度不了 100 个 agent」，而是这四条缝隙。

## 2code 的取舍清单

所以 2code 是围绕这四件事做的，也**只**围绕这四件事做。

做了：

- **持久终端 + 恢复。** 终端会话、scrollback、窗口布局在重启后恢复。回来看到的是离开时的样子。
- **Agent 状态检测。** 从终端输出、OSC 标题和进度序列里识别 agent 在跑 / 在等你 / 已结束，跑完亮绿点、响一声。把轮询换成推送。
- **Worktree 泳道。** 每个 worktree 一个独立窗口和独立终端上下文，profile 建在 `~/.2code/workspace/{id}`，创建时跑你在 `2code.json` 里定义的 setup script，删除时跑 teardown。
- **内置 git 与轻量编辑器。** diff、暂存区、提交历史就在同一个 App 里，顺手改个配置也不用切走。

刻意没做（现在不做，短期也不做）：

- **没有任务调度器 / 队列。** 2code 不替你决定哪个 agent 先跑、跑什么。
- **没有自动化 review 关卡。** 没有「agent 提交 → 自动 lint/test 门禁 → 合并」这条流水线。review 仍然是你来做，2code 只负责把它拉到离你最近的地方。
- **没有云端 runner / 远程 fleet。** 全部跑在你自己的机器上。
- **不做 IDE。** 编辑器只到「顺手改一下」的程度，我不打算和你现在的编辑器抢主力位置。
- **macOS 优先。** Windows 和 Linux 是实验支持，其中 Windows 的部分系统自定义能力还在验证。

我知道这份清单看起来「少」。但少和取舍是两回事——上面每一条「没做」，都是因为它服务的是另一个层级的问题，而不是因为我还没排上期。

顺带说一句我很喜欢的参照：JetBrains 在给 Fleet 收尾时那篇文章，最有价值的部分不是讲他们要做什么，而是讲他们**决定不做什么**。工具的诚实度，往往体现在这份清单上。

## 什么时候你该去用 Orca 或 Superset

这一段我想写得比夸自己更认真。

**去用编排器，如果：**

- 你是团队，需要把任务分配给一批 agent，而不是自己一条条起。
- 你的瓶颈已经明确是「review 扩不过去」，需要自动化关卡、批量 diff 审阅、跨任务的调度策略。
- 你真的需要几十上百条并行——比如批量迁移、大规模重构、跑 A/B 方案挑赢家。
- 你想要 25+ 个 agent 开箱即用地摆在一起随时对比。

**用 2code，如果：**

- 你的真实并发是 2–5 条，剩下的痛点是恢复、通知和 review 距离。
- 你想要的是一个每天都开着的工作台，而不是一套需要先配置好流程才能开始的系统。
- 你重度用终端，希望 CLI agent 就在它本来该在的地方跑，而不是被塞进某个侧边栏。

这两件事不互斥。工作台是底座，编排是上层。**底座没做好的时候，上层的收益是会打折的**——编排器可以帮你起 50 个 agent，但你桌面上那三个到底跑完没有，仍然要有人告诉你。

等到有一天，我自己的真实并发从 3 条涨到 30 条，我会认真去想上面那层怎么做。在那之前，承诺 100 是不诚实的。

## 先把三条泳道用顺

如果你数完自己的真实并发，发现也是两三条，而每天真正难受的是重启后要重新考古、是不敢离开桌子、是 diff 离你太远——那我们要解决的是同一个问题。

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/zh-cn>
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>

2code 还很早期，也还在动。但它承诺的东西很小：把你今天真实的那两三条线，做得不用你操心。
