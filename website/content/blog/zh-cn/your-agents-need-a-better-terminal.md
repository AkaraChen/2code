---
title: 你的 Agent 需要更好的终端
description: AI 编程真正的宿主是终端，但终端这些年一点没变。为什么这是工作台问题，而不是规模问题。
date: 2026-07-31
slug: your-agents-need-a-better-terminal
tags: [终端, Agent, worktree]
---

## 你今天开了几个终端？

先做个诚实的自查。此刻你的机器上：

- 开着几个终端窗口？
- 其中几个在跑 Claude Code 或 Codex——你确定它们跑完了吗？
- 几个 dev server，挂在某个你早就忘了的标签页里？
- 几个 worktree？分别对应哪条分支，是不是得 `git worktree list` 才能想起来？

这些数字加起来超过五，你就不是在「用终端」了。你是在人肉调度一个由窗口拼成的系统，而这个系统，从来没人给它写过 UI。

这篇文章讲的就是这件事：**AI 编程真正的宿主是终端，但终端这些年一点没变。**

## 为什么 Agent 总是发生在终端里

过去两年，代码 Agent 的形态收敛得很快。最好用的那批——Claude Code、Codex，还有一堆后来者——都是 CLI。不是插件，不是侧边栏 chat，是你 `cd` 进项目目录、敲一行命令、它就开始动手改文件的那种东西。

这不是巧合。CLI Agent 拿到的是完整的工作环境：真实的文件系统、真实的 git、真实的 `npm test`、真实的退出码。侧边栏 chat 拿到的，只是 IDE 愿意分出来的那一小块 API。前者能干活，后者只能建议。

所以现实是：你的 Agent 已经住在终端里了。它和你的 shell、你的环境变量、你的项目目录，共享同一个空间。

问题是，终端并不知道这件事。

## 普通终端缺什么

Terminal.app、iTerm、Ghostty，都是优秀的终端模拟器。它们的职责很清楚：把字符画到屏幕上，把按键送进 PTY。这件事它们做得很好。

但它们对下面这些一无所知：

**项目。** 终端只知道当前工作目录。它不知道 `~/code/api` 和 `~/.2code/workspace/abc123` 是同一个项目的两条任务线。这个映射，靠标签页命名和你的肌肉记忆维持。

**Worktree。** Git worktree 是 Agent 时代最被低估的原语：每个任务一个隔离的工作副本，agent 之间互不踩脚。但在普通终端里，三个 worktree 就是三个长得一模一样的窗口，标题栏都写着 `zsh`。

**Agent 状态。** 这条最要命。Agent 跑起来之后，它是在思考、在等你确认、还是二十分钟前就跑完了？终端不知道，它只知道有字符流过。于是你开始人肉轮询：切窗口、扫一眼、切回来、再切过去。

**现场。** 合上笔记本，第二天打开。窗口没了，scrollback 没了，跑到一半的命令没了，agent 的输出没了。你只能从零重建：重开窗口、重新 `cd`、重启 dev server、回想自己刚才在干嘛。

这四件事，单看每件都是小摩擦。叠在一起，就是每天几十次的注意力碎裂。

## 工具碎片化的真实成本

你可能已经用工具补过这些洞。典型配置是：

Terminal.app 开四个标签跑 agent，一个 GUI git 客户端看 diff，编辑器开着看代码，浏览器开着 localhost:3000，再加一个记事本，记着「哪个 worktree 对应哪个任务」。

这套配置能用。但它的成本不在任何一个工具上，而在工具之间：

- 你要在四个应用之间，维持一个只存在于脑子里的心智模型
- 每次 Cmd-Tab，都要重新定位「我刚才在哪」
- 没有一个工具能回答「现在有几个 agent 在跑」
- 重启之后，这套状态没有任何一部分会自己回来

行业里已经有几家在解这个问题，方向各不相同。Orca 的答案是 "Ship 100x With The Agent IDE"，重心放在规模化跑一队 agent。JetBrains Air 的答案是 "Multitask with agents, stay in control"，一个围绕 agent 重建的 ADE。Superset 说得更直接：*"You Don't Need Another AI Coding Agent — You Need an Orchestrator"*，它认为瓶颈在 agent 的数量管理。

这些判断都有道理。但它们共享同一个前提：你的问题是规模——你想同时跑十个、五十个 agent，所以需要一层编排。

我们的判断不太一样。

**大多数开发者的日常，不是编排五十个 agent，而是两三条任务线跑一整天，中间被切走十几次，然后希望回来时东西还在原地。**

这不是规模问题，是工作台问题。

## 2code 的答案：把它们收进一个终端

所以 2code 不是又一个 ADE，也不是编排器。

**2code 首先是一个完整的终端模拟器。** 你现有的 shell、prompt、别名、CLI agent，全部照常工作，不需要迁移任何东西。在这个基础上，我们把终端本来就该知道、却一直不知道的东西补上：

**持久终端。** 终端会话、scrollback、窗口布局，重启后恢复。你回来时看到的是离开时的样子，不是一片空白。跑了一半的东西不用重来。

**Worktree 窗口。** 每个项目、每个 worktree 都能开独立窗口，各带各的终端和上下文。一个修复、一个功能、一个实验，三条泳道互不干扰。切回某条线，看到的就是上次离开时的样子。Worktree profile 建在 `~/.2code/workspace/{id}`，创建时跑你在 `2code.json` 里定义的 setup script（比如 `npm install`），删除时跑 teardown。

**Agent 状态感知。** 2code 从终端输出、标题序列和进度序列里识别 agent 状态。跑完了，你会看到绿点、听到声音。这一条把「轮询」换成了「推送」——你不用再盯着四个 pane 看谁好了。

**内置轻量工具。** 文件树、轻量编辑器、简单的 git client。改个配置、看眼 diff、翻一下 commit 历史，这些高频小动作不用切应用。不是要替代你的 IDE，是让「顺手看一眼」不再值一次 Cmd-Tab。

**命令模板。** 每天都要开的那几个东西——Claude、dev server、你自己写的脚本——一键起。

普通终端只管命令。2code 还管项目、worktree 和 Agent。

## 适合谁，不适合谁

我们更愿意把这条说在前面，而不是让你下载完再失望。

**适合你，如果：**

- 你重度使用终端，CLI agent 是你的主力工作方式
- 你同时开着多个项目或多个 worktree，每天要在它们之间切
- 你被「这个 agent 跑完没有」打断过很多次
- 你在 macOS 上

**先别急，如果：**

- 你的工作流是一次一个 agent、一条分支跑到底——普通终端对你够用，2code 解决的摩擦你感受不强
- 你想要同时调度几十个 agent 的编排层——那是 Orca、Superset 更专注的方向，2code 不做这个
- 你主要在 Windows 或 Linux 上——这两个平台目前是实验性支持，其中 Windows 的部分系统自定义能力还在验证
- 你需要一个成熟稳定、零惊喜的工具——2code 还很早，仍在活跃开发中

我们不打算宣称 100x，也不打算说自己是最好的 ADE。2code 想解决的是一个具体得多的问题：让你的日常不丢现场。

## 试一下

如果你认得这个场景——

早上开三条泳道：一条修 bug，一条写功能，一条做实验。每条各带自己的终端、自己的 agent、自己的 dev server。中午 agent 跑完，绿点亮起，你打开 diff 扫一眼。下午合掉一条，挂起一条。晚上关掉 App，第二天打开，三条线还在原地。

——那 2code 大概值得你花五分钟装一下。

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/>（[中文](https://2code.akr.moe/zh-cn)）
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>

你的 Agent 已经住在终端里了。给它一个更好的。
