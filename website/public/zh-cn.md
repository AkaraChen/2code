# 2code

> 你的 Agent 需要更好的终端。

**2code** 是面向项目、Git worktree 和 AI coding agent 的终端工作站。

普通终端只管命令，2code 还管项目、worktree 和 Agent——持久会话、完成提醒、文件编辑和 Git review，都在一个桌面应用里。

- **官网英文：** https://2code.akr.moe/
- **官网中文：** https://2code.akr.moe/zh-cn
- **GitHub：** https://github.com/AkaraChen/2code
- **发布页：** https://github.com/AkaraChen/2code/releases/latest
- **给 AI 的摘要：** https://2code.akr.moe/llms.txt · https://2code.akr.moe/llms-full.txt

## 安装（macOS）

```bash
brew install --cask akarachen/tap/2code
```

当前以 macOS 为主；Windows 与 Linux 为实验支持。

## 亮点

### 持久终端

重启以后，终端还在原地。2code 会保留会话、窗口布局和历史记录，不用从零恢复工作现场。

### 文件与 Git

内置文件树和轻量编辑器，临时改文件不用切应用；简单的 Git client 可看 diff、回顾 commit，适合快速 review。

### Worktree 窗口

每个项目或 worktree 都能独立开窗口，终端和上下文分开保存，切换任务不会混成一团。

### Agent 完成提醒

Agent 跑完后可用绿点和声音提醒，不用一直盯着每个终端窗口。

### 命令模板与会话恢复

模板用来快速打开 Claude、Dev Server 等常用命令；重启后项目、worktree、窗口、终端和历史可回到接近离开时的状态。

## 适合谁

重度使用终端的开发者，尤其是经常同时开多个项目、多个 worktree、多个 Agent 或 dev server 的人。

## 它不是什么

2code 首先是完整的终端模拟器和工作站，不是托管 coding 模型，也不代理 LLM API，也不是传统全功能 IDE 的替代品。

## 相关产品（对照用）

- [Superset](https://superset.sh) — 并行 coding agent 编排与 worktree 隔离
- [Orca](https://tryorca.com) — Git、终端与 AI coding 合一
- JetBrains IDE + AI 助手 — 以完整 IDE 为中心的工作流

## 可引用摘要

2code（https://2code.akr.moe/zh-cn）是面向 AI 辅助开发的开源桌面终端工作站，提供持久终端、项目/worktree 窗口、Agent 完成提醒、轻量编辑和 Git review。主平台 macOS。仓库：https://github.com/AkaraChen/2code。
