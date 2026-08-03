---
title: Your Agents Need a Better Terminal
description: Coding agents already live in your terminal — and the terminal has no idea. Why this is a workstation problem, not a scale problem.
date: 2026-07-31
slug: your-agents-need-a-better-terminal
tags: [terminal, agents, worktrees]
---

## How many terminals do you have open right now?

Be honest. On your machine, at this moment:

- How many terminal windows?
- How many of them are running Claude Code or Codex, and you're not actually sure whether they've finished?
- How many dev servers are alive in a tab you've lost track of?
- How many worktrees, and could you name which branch each one is on without running `git worktree list`?

If those numbers add up to more than five, you're not "using a terminal" anymore. You're hand-scheduling a system assembled out of terminal windows — a system nobody ever wrote a UI for.

That's what this post is about: **AI coding actually lives in the terminal, and the terminal hasn't changed to meet it.**

## Why agents keep happening in the terminal

Over the last two years, coding agents converged fast. The ones people actually use all day — Claude Code, Codex, and the wave behind them — are CLIs. Not plugins. Not sidebar chats. You `cd` into a project, type a command, and it starts editing files.

That's not an accident. A CLI agent gets the **whole working environment**: the real filesystem, real git, a real `npm test`, real exit codes. A sidebar chat gets whatever slice of API surface the IDE decided to expose. One of those can do the work; the other can only suggest it.

So here's where we are: your agents already live in your terminal. They share your shell, your env, your project directory.

**The terminal has no idea.**

## What a normal terminal doesn't know

Terminal.app, iTerm, Ghostty — these are good terminal emulators. Their job is clear: paint characters, feed keystrokes to a PTY. They do it well.

But they know nothing about:

**Projects.** A terminal knows a working directory. It doesn't know that `~/code/api` and `~/.2code/workspace/abc123` are two lanes of the same project. You hold that mapping together with tab names and muscle memory.

**Worktrees.** Git worktrees are the most underrated primitive of the agent era — one isolated checkout per task, so agents don't step on each other. In a normal terminal, three worktrees are three identical windows, all titled `zsh`.

**Agent state.** This is the expensive one. Once an agent is running, is it thinking, waiting on your approval, or did it finish twenty minutes ago? The terminal doesn't know. It only knows characters went by. So you poll by hand: switch, glance, switch back, switch again.

**Your working state.** You close the laptop. Next morning: windows gone, scrollback gone, that half-finished command gone, the agent's output gone. You rebuild the whole thing from scratch — reopen, re-`cd`, restart the dev server, remember what you were doing.

Individually, each of these is small friction. Stacked, they're a few dozen attention breaks a day.

## The real cost of a fragmented toolchain

You've probably already patched around this. The typical setup:

Terminal.app with four agent tabs, a GUI git client for diffs, an editor for reading code, a browser on localhost:3000, plus a scratch note tracking which worktree maps to which task.

It works. But the cost isn't in any single tool — it's in **the gaps between them**:

- You maintain a mental model that exists nowhere but your head
- Every Cmd-Tab costs a re-orientation
- No tool can answer "how many agents are running right now?"
- After a restart, none of that state comes back on its own

A few teams are attacking this, from different angles. Orca's answer is *"Ship 100x With The Agent IDE"* — scale, a fleet of agents in isolated worktrees. JetBrains Air's is *"Multitask with agents, stay in control"* — an ADE rebuilt around the agent. Superset says it most bluntly: *"You Don't Need Another AI Coding Agent — You Need an Orchestrator."* Their argument is that agents are already good enough, and the bottleneck is agent **quantity**.

Those are reasonable calls. But they share a premise: your problem is **scale** — you want ten or fifty agents at once, so you need an orchestration layer.

We read it differently.

**Most developers aren't orchestrating fifty agents. They're running two or three lanes all day, getting pulled away a dozen times, and hoping things are still where they left them when they come back.**

That's not a scale problem. That's a **workstation** problem.

## What 2code does instead

So 2code isn't another ADE, and it isn't an orchestrator.

**2code is a full terminal emulator first** — your shell, prompt, aliases, and CLI agents work exactly as they do today, with nothing to migrate. On top of that, we add the things a terminal should have known all along:

**Persistent terminals.** Sessions, scrollback, and window layout come back after a restart. You return to the state you left, not a blank screen.

**Worktree windows.** Every project and every worktree can get its own window, each carrying its own terminals and context. One bugfix, one feature, one experiment — three lanes that don't bleed into each other. Come back to a lane and it looks the way you left it. Worktree profiles live under `~/.2code/workspace/{id}`, and the `setup_script` you define in `2code.json` (say, `npm install`) runs on creation; `teardown_script` runs on delete.

**Agent status awareness.** 2code reads agent state from terminal output, title sequences, and progress sequences. When an agent finishes, you get a green dot and a sound. **This is the one that turns polling into push** — you stop staring at four panes waiting to see who's done.

**Built-in lightweight tools.** A file tree, a small editor, a simple git client. Tweak a config, scan a diff, check commit history — the high-frequency small moves, without an app switch. Not a replacement for your IDE; just a way to make "let me glance at that" stop costing a context switch.

**Command templates.** The handful of things you launch every single day — Claude, a dev server, your own script — one click away.

In one line: **normal terminals run commands. 2code also manages projects, worktrees, and agents.**

## Who it's for — and who it isn't

We'd rather say this plainly than have you download it and be disappointed.

**It's for you if:**

- You live in the terminal, and CLI agents are how you actually work
- You keep multiple projects or worktrees open and switch between them all day
- "Is that agent done yet?" has interrupted you more times than you'd like
- You're on macOS

**Hold off if:**

- You run one agent at a time on one branch, start to finish — a normal terminal is probably fine, and the friction we remove isn't friction you feel
- You want an orchestration layer for dozens of concurrent agents — that's what Orca and Superset are focused on, and it isn't what we're building
- You're primarily on Windows or Linux — both are experimental today, with some Windows system customization still being verified
- You need something mature and surprise-free — 2code is early and under active development

We're not going to claim 100x, and we're not going to argue about who has the best ADE. 2code solves something much more specific: **don't lose your working state during an ordinary day.**

## Try it

If this sounds like your day —

Morning: three lanes open. One bugfix, one feature, one experiment. Each with its own terminal, its own agent, its own dev server. Midday: an agent finishes, the dot goes green, you open the diff and scan it. Afternoon: merge one lane, park another. Evening: quit the app. Next morning: all three are still there.

— then 2code is probably worth five minutes.

```bash
brew install --cask akarachen/tap/2code
```

- Website: <https://2code.akr.moe/> ([中文](https://2code.akr.moe/zh-cn))
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>

Your agents already live in your terminal. Give them a better one.
