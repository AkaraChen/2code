---
title: "Git Worktree 简明指南（为 AI Agent 重写）"
description: "一个让零基础也能跟做的 git worktree 教程：是什么、为什么并行 agent 需要它、三条命令上手、四个一定会踩的坑，以及什么时候不该用它。"
date: 2026-08-07
publishAt: 2026-08-07T00:00:00+08:00
slug: git-worktree-guide-for-ai-agents
tags:
  [
    Git worktree,
    git worktrees,
    git worktree ai agent,
    Git 教程,
    并行 Agent,
    parallel coding agents,
    Claude Code,
    Codex,
    Superset,
    Orca,
    终端工作站,
  ]
---

## 这篇指南为什么存在

`git worktree` 在 Git 里躺了十年，一直是个冷门功能——直到 AI agent 把它变成了日常。

原因很直接：你让两个 agent 同时在同一个仓库里干活，它们就会同时改文件。切分支解决不了这个问题，因为整个 Git 历史上，分支切换都假设**你只有一个工作目录**。

Worktree 打破的正是这个假设。这篇只讲够用的部分：一个概念、三条命令、四个坑。读完你就能跟着做。

## Worktree 是什么：一份仓库，多份工作目录

普通仓库长这样：一个目录，里面一份代码，同一时刻只能检出一个分支。

Worktree 允许同一个仓库同时拥有**几份工作目录**，各自检出不同的分支，但共享同一份 `.git` 对象库：

```
                ┌──────────────────────────┐
                │  .git 对象库（只有一份）  │
                │  所有提交、分支都在这里   │
                └────────────┬─────────────┘
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ~/code/my-app     ~/code/my-app-fix    ~/code/my-app-exp
   分支：main         分支：fix/login-500  分支：exp/new-cache
   你自己改           Agent A 在这里干活   Agent B 在这里干活
```

关键点有三个：

1. **不用重新 clone。** 新工作目录共享对象库，创建是秒级的，不占双份磁盘历史。
2. **文件互相看不见。** 三个目录是三棵独立的文件树，agent 在其中一个里怎么改，都不碰另一个。
3. **`.git` 在新目录里是一个文件**，不是文件夹——它只是指回主仓库的指针。所以「共享历史、独立文件」这两件事同时成立。

官方文档在 [git-worktree](https://git-scm.com/docs/git-worktree)，下面是最小可用版。

## 为什么切 branch 不够

也许你会想：并行而已，多切几条分支不就行了？

不行，因为**分支切换共享同一份工作目录**。`git checkout` 换分支的瞬间，磁盘上的文件会被整批改写。这对人类只是有点烦，对 agent 是灾难：

- Agent 一次任务跑十几分钟，期间文件一直在变。你这头一切分支，它手里的半成品工作区直接乱掉。
- 两个 agent 在同一个目录里跑，就是两个工人抢同一张桌子——改到同一个文件时，diff 变成一锅粥，你分不清哪行是为了哪件事。
- 未提交的改动跟着分支走。你切去救火，回来时工作区已经不是你离开时的样子。

一句话：**分支隔离的是历史，worktree 隔离的才是文件。** 并行 agent 需要的是后者。

## 最小命令集：add / list / remove

真要用起来，三条命令就够。假设你在 `~/code/my-app`：

**建一个。** 给「修登录 500」这个任务开一份工作目录，顺手建一条新分支：

```bash
git worktree add ../my-app-fix -b fix/login-500
```

惯例是把新目录放在主仓库**旁边**（`../`），不要嵌套在仓库里面。想检出已有分支而不是新建，去掉 `-b`：

```bash
git worktree add ../my-app-release release/1.4
```

**看有几个。** 随时清点：

```bash
git worktree list
```

**删一个。** 任务结束，回主仓库执行：

```bash
git worktree remove ../my-app-fix
```

目录里还有未提交改动或未跟踪文件时，Git 会拒绝删除——这是保护，不是 bug。确认要丢，加 `--force`。分支本身不受影响，删掉的只是工作目录。

再加一条急救命令：如果你图快用 `rm -rf` 把目录删了，Git 的记录还留着，用 `git worktree prune` 清理尸体。

就这些。剩下都是使用场景的事。

## Agent 场景：一个任务，一个 worktree

有了这三条命令，并行 agent 的标准做法就出来了：

1. 每来一个任务，`git worktree add` 一份目录 + 一条分支；
2. 让 agent 进**那个目录**干活（Claude Code、Codex 或你顺手的 CLI，在对应目录里启动即可）；
3. 你去忙别的。完成后进那个目录看 diff、跑测试，满意就合并、提 PR；
4. `git worktree remove`，收工。

每条任务线有自己的文件树、自己的分支、自己的 diff。Review 的时候你永远知道「这份改动是为了哪件事」，因为分支和任务是一一对应的。

至于这种「一天三条线」具体怎么流转，可以看姊妹篇[《用 Worktree 当 Agent 工位：我的一天并行工作流》](/zh-cn/blog/worktree-as-agent-workstations)，这篇只管把工具本身讲清楚。

## 四个一定会踩的坑

**一、`node_modules` 不会跟过去。** 新工作目录是干净的检出，被 `.gitignore` 忽略的东西一律不在——依赖要重新装。每个 worktree 各装一份确实费磁盘，这是 worktree 模型真实的成本，接受它，或者用脚本自动化（下面讲）。

**二、`.env` 也不会跟过去。** 同理，环境变量文件通常被 ignore，新目录里没有。要么手动 `cp .env ../my-app-fix/`，要么把 `cp .env.example .env` 写进初始化脚本。agent 起不来、报一堆「环境变量未定义」，八成是这个。

**三、端口不隔离。** Worktree 隔离的是文件树，不是你的端口表。两条线都起 `localhost:3000`，后起的必挂。给每条线约定不同端口，或者「同时只热一条 UI」。数据库、Docker 容器、全局缓存同理——它们都是**共享状态**，worktree 管不着。

**四、子模块要重新初始化。** 仓库里有 submodule 时，每个新 worktree 里都要跑一遍 `git submodule update --init`，否则子模块目录是空的。

附带一个高频报错：`fatal: 'xxx' is already checked out at ...`。Git 不允许同一条分支同时被两个 worktree 检出——这恰恰是它替你挡掉的互相踩脚。换个分支名就行。

## 什么时候不该用 worktree

诚实一点，这个工具不是万能的：

- **单人单 agent，一次只做一件事**：老实切 branch 就好，worktree 是纯开销。
- **一次性改两行**：建目录、装依赖、删目录，比你改代码还慢。
- **需要环境级隔离**：不同依赖版本、不同数据库、不同系统配置——worktree 只隔离文件树，这些要上容器或云开发环境。
- **仓库巨大且依赖安装极慢**：每个 worktree 一份 `node_modules` 的成本会先于收益到达，先评估磁盘和时间。

## 手动 vs 工具

三条命令手动敲，管一两条线完全够。线一多，重复劳动就显出来了：建目录、起名、装依赖、拷 `.env`、收尾删除——每个任务来一遍。

这正是工具层在做的事，各家做法不同：

- **2code**（我们的工作台）把 worktree 做成「工位」：创建 profile 时自动 `git worktree add` 到 `~/.2code/workspace/{id}`，配套一条新分支；项目根的 `2code.json` 里写好 `setup_script`（比如 `npm install`、`cp .env.example .env`），新工位起来时自动按顺序跑；删掉工位时先跑 `teardown_script`，再 `git worktree remove` 收尾。上面坑一、坑二就这么被脚本消化掉了。
- **Superset** 面向更大规模的并行：几十个 agent 的队列和 review 关卡，worktree 是它的底层隔离手段。
- **Orca** 把「任务 = worktree + agent 终端 + 浏览器」打包成一个单元，偏舰队式管理。

共同点是：大家都没有发明新的隔离技术，都是把 `git worktree` 这件十年前的老功能，接到 agent 时代的日常里。区别只在你要管几条线。

## 自己试一下

最小路径：挑一个你正在做的仓库，现在就开一条：

```bash
git worktree add ../my-app-try -b try/first-worktree
```

让 agent 进去做一件你本来就要做的小事，你去忙别的。半小时后回来，`git worktree list` 看一眼，`git worktree remove` 收掉。整个生命周期就走完了。

如果你嫌手动流程碎，或者想顺便解决「agent 跑完了没人喊你」的问题：

```bash
brew install --cask akarachen/tap/2code
```

- 官网：<https://2code.akr.moe/>（[English](https://2code.akr.moe/)）
- GitHub：<https://github.com/AkaraChen/2code> — 开源，欢迎 issue 和 star
- 最新版本：<https://github.com/AkaraChen/2code/releases/latest>
- Worktree 官方文档：<https://git-scm.com/docs/git-worktree>

Worktree 不难，它只是等了十年，才等到一个需要它的场景。
