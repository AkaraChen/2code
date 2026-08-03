---
title: "误区：「Worktree 太重，branch 就够」"
description: "Branch 切换共享同一份工作目录，两个 agent 同时改文件必然互踩。Worktree 是同一个对象库、多份工作目录——它不为炫技存在，重的部分也早已被工具吃掉。"
date: 2026-08-10
publishAt: 2026-08-10T00:00:00+08:00
slug: git-worktree-too-heavy-branch-enough
tags:
  [
    Git worktree,
    git worktrees,
    git branch,
    并行 Agent,
    parallel coding agents,
    Claude Code,
    Codex,
    Superset,
    Orca,
    JetBrains Air,
    Agent 工位,
    终端工作站,
  ]
---

## 误区原话

> 「Git worktree 太重了。多一份目录、多装一遍依赖、多记一堆路径——我就想让两个 agent 同时干活，开两条 branch 不就行了？」

这话听起来非常有道理，因为 branch 是真的轻：`git switch -c`，一秒钟的事。而 worktree 听起来像「把仓库又克隆了一遍」。

但这个对比从一开始就错位了：**branch 和 worktree 隔离的不是同一层东西。**

## 一张图：branch 和 worktree 到底差在哪

```text
branch 切换：一份工作目录，轮流扮演每条分支

  ~/repo/                  ← 唯一的工作目录
    此刻是 feature-a
    git switch hotfix → 同一个目录，内容被替换成 hotfix

worktree：一个对象库，多份工作目录同时在场

  .git/（对象库只有一份，不重复占磁盘）
    ├── ~/repo/            ← main
    ├── ~/repo-feature/    ← feature-a
    └── ~/repo-hotfix/     ← hotfix，三份目录同时存在
```

`git switch` 换分支，是把**同一份工作目录**里的文件替换成另一条分支的样子。目录只有一个，「它此刻是哪条分支」是互斥的。

`git worktree add` 是从**同一个对象库**再检出一份目录。提交历史、对象数据全部共享，磁盘上多的只是工作文件；但目录有两份，各自一条分支，**同时在场**。

这不是什么新玩具。Worktree 在 2015 年的 Git 2.5 就有了，原本是给「改到一半要切去修紧急 bug」的人准备的。它等并行 agent 这个场景，等了十多年。

## 先说公道话：什么时候 branch 真的够

单人、单 agent、一次只推进一件事——这种情况下说 worktree 太重，是对的。

Agent 在跑的时候你就盯着它，改完、提交、再切下一条。整个工作流是串行的，一份工作目录没有任何问题。这时候引入 worktree，确实只是多了一份要记的目录。

判断标准只有一句话：

**同一时刻，有没有两个「会写文件的东西」在同一个目录里工作？没有，branch 够；有，branch 就不够。**

## 并行 agent：branch 隔离的那层，恰好不是 agent 工作的那层

Agent 不是在看代码，是在**改**代码——而且一跑就是十几分钟。

设想两个很普通的场景：

**场景一：一个 agent + 你自己。** Agent A 改到一半，线上来个紧急 bug，你想自己上手修。`git switch` 一切，A 脚下的地就换了：它刚读过的文件内容变了，未提交的改动要么挡住 checkout，要么被带进另一条分支；测试跑到一半，目录已经不是它以为的那个目录。

**场景二：两个 agent。** 两个写者抢同一批文件，diff 搅成一锅粥；`git status` 里分不清哪行是谁改的、为了哪件事；dev server 端口互踩，你分不清是谁起的、该杀哪个。

问题的根源是：**branch 隔离的是提交历史，不是文件系统。而 agent 恰恰活在文件系统里。** 你拿一个管历史的工具，去解决工作目录的冲突，层就不对。

## 「重」的到底是哪部分

拆开看，worktree 本身一点都不重：`git worktree add ../repo-fix fix` 一条命令的事，对象库共享，没有第二次克隆。

真正重的是**环境**：`node_modules` 要重新装，`.env` 要拷，端口要错开，用完了要记得删。手动做，每条任务线多花几分钟，还经常忘。大多数人骂的「worktree 太重」，骂的其实是这部分。

而这部分恰恰是工具该吃掉的：

- **脚本**：把 setup / teardown 写成两条命令，建和删都不再靠记性；
- **2code 工位**：建工位时自动 `git worktree add`，并跑项目 `2code.json` 里写好的 setup（比如 `npm install`）；删工位时跑 teardown，目录和分支一起清掉。重的部分自动化之后，剩下的只有收益。

顺带一提，这不只是 2code 的判断。Orca 里一个 task 就是一个 worktree；JetBrains Air 的运行环境就三档：Local Workspace / Git Worktree / Docker；Superset 的整个并行模型同样建立在 worktree 上。几家不约而同把隔离单位定在这里，因为 worktree 恰好是「刚好够隔离」的那一层——**比 branch 硬，比 clone 和容器轻。**

所以成本公式是反的：branch 省的是一次性建环境的几分钟，代价是并行时每次冲突丢掉的半小时。工具把前者抹平之后，branch 的「轻」只在串行时成立。

## 延伸阅读

想把 worktree 真正用进一天的并行工作流，推荐接着读姊妹篇《[用 Worktree 当 Agent 工位：我的一天并行工作流](/zh-cn/blog/worktree-as-agent-workstations)》——三条任务线跑一整天，绿点亮了再回来扫 diff。

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/>（[English](https://2code.akr.moe/)）
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>
- Worktree 官方文档：<https://git-scm.com/docs/git-worktree>

Worktree 不重。**让两个写者挤在同一张桌子上，才重。**
