---
title: "从 Chat 补全到 Agentic Loop：工作流变了什么"
description: "补全和 chat 是同步短循环，agentic loop 是异步长循环。JetBrains 用停掉 Fleet 换来的结论，以及你的键盘动作具体会怎么变。"
date: 2026-08-06
publishAt: 2026-08-06T00:00:00+08:00
slug: from-chat-completion-to-agentic-loop
tags:
  [
    agentic loop,
    Chat 补全,
    Agentic IDE,
    Claude Code,
    Codex,
    JetBrains Air,
    Fleet,
    Superset,
    终端工作站,
  ]
---

## 一个动作的变化

2022 年，AI 编程的标志性动作是按 **tab**。Copilot 吐出灰字，你按一下 tab 收下，手不离开键盘，一个循环几秒钟。

2023 年，动作变成了 **⌘K**。选中一段代码，用自然语言说要什么，等几秒，收下一段 diff 或一个代码块。还是同步的：它生成的时候，你只能等。

2025 年之后，动作变成了**写一段话，按回车，然后离开**。Agent 自己跑十分钟、半小时，回来的时候交给你一整个 patch。

表面上只是等待变长了。实际上你和工具的关系掉了个头：前两段里，AI 围着你的光标转；第三段里，你围着 AI 的结果转。JetBrains 给第三段起了个名字：**agentic loop**。

## 三阶段，一条曲线

把 2022 到 2026 年开发者和 AI 的交互压缩一下，大致是三个阶段：

**补全。** 单位是下一行。AI 读你光标前后的上下文，猜你要写什么。它不执行任务，只替你省击键。

**Chat 和内联编辑。** 单位是这一轮对话。你描述一个局部问题，它给局部答案。上下文靠你手动喂：选中、粘贴、@文件。

**Agentic loop。** 单位是一个任务。你定义目标和验收，它自己拆解、跑命令、改文件、跑测试，最后交回一个可以 review 的完整改动。

分界线不是「模型变强了」——模型确实变强了，但真正的变化是**循环的结构**。前两段是同步短循环：你发起，你等待，你接受，全程在编辑器里，以秒计。第三段是异步长循环：你发起之后，最有价值的动作是**去干别的**。

## 同步 vs 异步，不只是快慢

| | 同步短循环（补全 / chat） | 异步长循环（agentic loop） |
| --- | --- | --- |
| 交互单位 | 光标位置、这轮对话 | 一个任务 |
| 时间尺度 | 秒 | 分钟到小时 |
| 你的角色 | 打字员 + 即时裁判 | 任务定义者 + 事后 reviewer |
| 执行环境 | 你唯一的工作区 | 隔离环境（worktree / 容器），可并行多个 |
| 产出 | 几行代码、一段建议 | 完整 patch，review-first |
| 卡住的成本 | 等几秒，不耐烦 | 它空转十分钟，你没发现 |

表里最容易被低估的是最后一行。同步循环里，卡住的成本是几秒钟不耐烦；异步循环里，卡住的成本是你**根本不知道它卡住了**。这个问题本身值得一篇，我们写过：[《Agent 跑完了，你怎么知道？》](/zh-cn/blog/how-do-you-know-your-agent-is-done)。

## JetBrains 用停掉一个产品换来的结论

2025 年 12 月，JetBrains 宣布 Fleet 停止下载。官方博文里有一段话值得读原文，因为它是用一个产品线的命换来的：

> The agentic loop relies on structured task definition, context assembly, multiple asynchronous runs, isolated execution, and review-first workflows.

这段话的背景：JetBrains 先试过把 Fleet 做成 AI-first 编辑器，评估之后放弃了——市场上 AI-first 的 VS Code fork 已经够多，再做一个没有差异化。他们的结论是，经典 IDE 工作流和 agentic loop **硬塞进同一个工具，体验是割裂的**（原话：*combining them in a single tool results in a disjointed experience*）。

后来的事大家都知道了：Fleet 团队转身做了 Air，一个围绕 agent 重建的环境。Air 的发布博文把分工说得很直白：

> IDEs add tools to the code editor, while Air builds tools around the agent.

还有一句更重要：**Air handles the agent-powered development; your IDE handles the rest.** 不替代你的 IDE，把它管不了的那一半接走。落到具体功能上也能看出这个思路：在 Air 里定义任务，你可以直接引用某一行、某个 commit、某个符号，agent 拿到的是精确上下文，而不是你粘贴的一大坨文本。

引用到此为止。这两篇博文真正值钱的地方，是把「工具为什么要分叉」讲清楚了：不是编辑器不够聪明，是**同步工具和异步任务在结构上就不是一个东西**。光标的中心是「现在」，任务的中心是「将来的某个完成时刻」，一个界面很难同时以两者为中心。

## 你的键盘动作，具体怎么变

认知文写到这里最容易空。所以只说动作，你可以对照自己的一天。

**任务定义代替了光标定位。** 以前你走到 bug 现场，选中，⌘K。现在你用一段话描述任务：目标、约束、验收标准，写完发给 agent。Air 团队的 dogfood 记录里有个诚实的细节：agent 在代码设计、架构和遵循项目惯例上表现很差，所以他们的工程师是自己搭好结构，再让 agent 收尾。任务定义里省掉的每一句，都会在 review 时加倍要回来。

**开隔离环境代替了切分支。** 异步意味着并行，并行意味着 agent 不能直接在你的主工作区里改。具体动作：给这个任务开一个 worktree（或者容器），让它在里面跑。两个 agent 在同一个目录干活会互相踩——Superset 那篇 [orchestration 文章](https://superset.sh/blog/agent-orchestration-not-another-agent)把这叫隔离问题，它也是 git worktree 这个十多年的老功能突然翻红的原因。

**等通知代替了盯屏幕。** 同步循环里，等待是默认姿势；异步循环里，盯着看是最亏的姿势——你付了并行的成本，没拿并行的收益。正确动作：起完任务，物理离开，让「跑完了」或「在等你」以通知的形式来找你。

**扫 diff 代替了看它写。** Review-first 的意思是：你第一次见到 agent 的产出时，它已经是完整的 patch。你的动作从「看它生成」变成「扫 diff，决定合不合；不合就写一句 review comment，让它再跑一轮」。你的判断力第一次比打字速度值钱。

**合并收尾代替了复制粘贴。** Chat 时代的最后一步是把代码块粘进编辑器；agentic loop 的最后一步是把 worktree 里的改动合回主副本，然后清掉这条泳道。

数一数：五个动作，没有一个发生在光标位置上。这就是「以光标为中心的工具会割裂」的具体含义——不是编辑器没用了，而是你一天里越来越多的事，根本不经过光标。

## 2code 在这条曲线上的位置

先说 2code 不是什么：不是 IDE，不做编辑器，也不做「AI-first 编辑器」——那条路 JetBrains 已经替大家验证过了。

2code 是终端工作站，承接的是 agentic loop 里**「现场」的那一半**。CLI agent（Claude Code、Codex 这些）真正跑起来的地方是终端，上面那五个动作，落在 2code 里长这样：

- **开隔离环境** → worktree 窗口：每个 worktree 一个独立窗口，各带各的终端和上下文。创建时自动跑你在 `2code.json` 里定义的 setup script，不用手动配环境。
- **等通知** → agent 状态感知：从终端输出、标题序列和进度序列里识别 agent 的状态。在跑是轻轻呼吸的绿点；跑完了是一个静止的绿点，安静亮着；只有「在等你拍板」才会响一声。
- **扫 diff** → 内置 git：diff、暂存区、提交历史就在终端旁边，review 不用切走。
- **现场不丢** → 持久终端：合上电脑、重启 App，会话和布局恢复到离开时的样子。异步循环动辄几十分钟，中间任何一次现场丢失都等于重开任务。

至于任务定义那一步，2code 刻意不碰——那是你和 agent 之间的事，发生在 agent 自己的界面里。工具该有边界。

## 延伸阅读

这篇的认知台阶全部来自下面几篇一手来源，值得读原文：

- [The Future of Fleet](https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/)——JetBrains 停掉 Fleet 的官方说明，agentic loop 五个特征的出处
- [Air Launches as Public Preview](https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/)——「IDE 把工具加进编辑器，Air 围绕 agent 造工具」
- [My Journey to Agent-First Development with Air](https://blog.jetbrains.com/air/2026/04/my-journey-to-agent-first-development-with-air/)——Air 团队的 dogfood 记录，有很多「人做什么、agent 做什么」的一手分工细节
- [You Don't Need Another AI Coding Agent](https://superset.sh/blog/agent-orchestration-not-another-agent)——Superset 论为什么瓶颈是工作流，而不是再来一个 agent

## 试一下

如果你的动作还停留在前两段——tab、⌘K、复制粘贴——这不丢人，同步循环在局部问题上依然是最快的。但如果你已经开始「写一段话，按回车，离开」，你需要的东西已经变了：一个能开泳道、会叫你、让 diff 就在手边的现场。

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/>（[English](https://2code.akr.moe/)）
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>

光标归你，任务归它。
