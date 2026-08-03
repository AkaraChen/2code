---
title: "误区：多开几个终端窗口 = 并行 Agent 工作流"
description: "开四个终端窗口跑四个 agent，看起来就是并行了。但窗口只解决「字符看得见」，不解决文件隔离、会话恢复和 review——这三件事才会真的炸。"
date: 2026-08-07
publishAt: 2026-08-07T00:00:00+08:00
slug: terminal-windows-are-not-a-parallel-workflow
tags:
  [
    误区,
    并行 Agent,
    git worktrees,
    parallel coding agents,
    agent orchestration,
    Agentic IDE,
    Superset,
    Orca,
    JetBrains Air,
    Claude Code,
    Codex,
    Agent 工位,
    终端工作站,
  ]
---

## 「多开几个窗口，不就并行了？」

「并行跑 agent 有什么难的？多开几个终端窗口，一个窗口一个 Claude Code，搞定。」

这是关于并行 AI 编程最流行的判断，也是最贵的一个。它把「并行工作流」和「并排的窗口」划上了等号，而这两者之间隔着三件会爆炸的事。

## 为什么它看起来像那么回事

因为窗口确实解决了一个问题：看得见。

四个窗口铺开，每个 agent 的输出都在屏幕上。对单个 agent 来说，终端窗口甚至就是全部真相——CLI agent 本来就长在终端里。于是直觉外推：一个 agent 一个窗口，N 个 agent N 个窗口。

头一个小时，这个等式几乎成立。问题出在第一个小时之后。

## 真正会炸的三个点

**一、文件互相踩。** 四个窗口 `cd` 进同一个仓库，等于四个 agent 共用一份工作副本、一个 git 暂存区。Superset 的[并行指南](https://superset.sh/blog/parallel-coding-agents-guide)写得很直白：哪怕两个 agent 改的是不同文件，共享的 git index 也会让提交裹进彼此没改完的东西。窗口是分开的，文件系统不是。

**二、丢会话。** 笔记本合盖、手滑关了窗口、系统更新重启，终端会话一死，上下文跟着死。一个 agent 时这叫烦人，四个 agent 时这叫灾难：哪个窗口在修 bug、跑到哪一步、接下来要干嘛，窗口从来不替你记，全靠你的脑子——而你的脑子同时还要用来写代码。

**三、review 地狱。** Agent 说改完了，改动散在四个窗口、四条分支里——如果你还记得给每个窗口切分支的话。于是你在终端、git 工具、编辑器之间来回切，把「谁改了哪些文件、为了哪件事」重新拼出来。并行省下的时间，在这里又还了回去。

顺带一提，窗口连「看得见」也只解决了一半：你能看见字符，看不见状态。一个跑完的 agent 和一个卡住的 agent，在屏幕上可以长得一模一样。这块是另一个话题，我们在[《Agent 跑完了，你怎么知道？》](/zh-cn/blog/how-do-you-know-your-agent-is-done)里单独拆过。

## 最小正确做法

把上面三个坑填上，就得到一份最小正确做法清单，四条：

- **一个任务一份隔离的工作副本。** 用 git worktree：独立目录、独立分支、独立暂存区，共享对象库，建一个只要几秒。
- **会话比窗口活得久。** 关窗、重启、第二天再开，终端历史和 agent 上下文还在原地。
- **完成主动来找你。** 状态标识或通知替你轮询，而不是你每两分钟切一圈。
- **diff 收进一处。** 扫一眼决定合、改还是丢，中间不跨 App。

注意，四条里没有一条是「开更多窗口」。窗口是显示层，工作流是状态层。

## 2code 把这张清单做便宜

这四条你自己也拼得出来：tmux 管会话，脚本管 worktree，再找个 App 看 diff。能跑，但你要维护这套拼装本身。

2code 是一个终端模拟器，区别是它把清单做成了默认配置：建 profile 时自动 `git worktree add`，初始化命令写在项目根的 `2code.json` 里；终端会话、scrollback 和窗口布局重启后恢复；agent 状态从终端输出里识别，跑完亮绿点，等你拍板时黄点加一声提示音；内置 git diff 和提交历史，review 不用离开窗口。

英文里这叫 workstation，中文我们叫它 **agent 工位**：一个任务一张桌子，桌上是独立的 worktree、终端和 agent，你走过来验收。

## 试一下

如果你现在的「并行」是四个 Terminal.app 窗口加一个好记性，可以换一种过法：

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/>（[中文](https://2code.akr.moe/zh-cn)）
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>
- 延伸阅读：[用 Worktree 当 Agent 工位：我的一天并行工作流](/zh-cn/blog/worktree-as-agent-workstations) · [Agent 跑完了，你怎么知道？](/zh-cn/blog/how-do-you-know-your-agent-is-done)

多开窗口不是错，它是起点。但工作流从窗口之外开始：隔离、恢复、通知，和一条不用考古的 review 路径。
