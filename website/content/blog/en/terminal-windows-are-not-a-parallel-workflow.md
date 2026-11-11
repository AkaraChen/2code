---
title: "Myth: A Few More Terminal Windows = a Parallel Agent Workflow"
description: "Four terminal windows, four agents — looks like parallelism. But windows only put characters on a screen. They don't give you file isolation, session recovery, or a review path, and those are the three places it actually blows up."
date: 2026-08-07
publishAt: 2026-08-07T00:00:00+08:00
slug: terminal-windows-are-not-a-parallel-workflow
tags:
  [
    parallel agents,
    git worktrees,
    agent orchestration,
    agentic IDE,
    Superset,
    Orca,
    JetBrains Air,
    Claude Code,
    Codex,
    agent workstation,
    terminal workstation,
  ]
---

## "Just open a few more windows, right?"

"What's so hard about running agents in parallel? Open a few terminal windows, one Claude Code per window, done."

This is the most popular take on parallel AI coding, and the most expensive one. It equates a parallel workflow with windows sitting side by side — and between those two things sit three failure modes that actually explode.

## Why it looks right

Because windows do solve one problem: visibility.

Tile four windows, and every agent's output is on screen. For a single agent, a terminal window is even the whole truth — CLI agents live in the terminal anyway. So the intuition extrapolates: one agent, one window; N agents, N windows.

For the first hour, the equation almost holds. The trouble starts after the first hour.

## The three places it blows up

**One, files trample each other.** Four windows `cd`'d into the same repo means four agents sharing one working copy and one git index. Superset's [parallel guide](https://superset.sh/blog/parallel-coding-agents-guide) puts it bluntly: even when two agents edit different files, a shared git index means their commits can sweep up each other's unfinished changes. The windows are separate. The filesystem isn't.

**Two, sessions die.** Laptop lid closes, a window gets closed by accident, a system update reboots the machine — the terminal session dies and the context dies with it. With one agent that's annoying. With four it's a disaster: which window was fixing the bug, how far it got, what the next step was — no window remembers any of this for you. Your brain does, and your brain is also supposed to be writing code.

**Three, review hell.** The agent says it's done, and the changes are scattered across four windows and four branches — assuming you remembered to cut a branch per window at all. So you bounce between terminals, a git tool, and your editor, reassembling "who changed which files, for which task." The time parallelism saved gets paid back right here.

And one more thing, for free: windows only solve half of "visibility" anyway. You can see characters, not state. A finished agent and a stuck agent can look identical on screen. That's its own topic — we took it apart in [How Do You Know Your Agent Is Done?](/blog/how-do-you-know-your-agent-is-done).

## The minimum correct setup

Fill those three holes and you get a minimum viable checklist — four items:

- **One isolated working copy per task.** Use git worktrees: separate directory, separate branch, separate index, shared object store, created in seconds.
- **Sessions outlive windows.** Close the window, restart, come back tomorrow — terminal history and agent context are still where you left them.
- **Completion comes to you.** A status signal or notification polls for you, instead of you cycling through windows every two minutes.
- **Diffs land in one place.** One glance decides merge, fix, or discard — no app-hopping in between.

Notice that none of the four is "open more windows." Windows are the display layer. A workflow is the state layer.

## 2code makes the checklist cheap

You can assemble all four yourself: tmux for sessions, scripts for worktrees, some app for diffs. It works — and then you maintain the assembly itself.

2code is a terminal emulator, with the difference that the checklist is the default configuration: creating a profile runs `git worktree add` for you, with setup commands in the project's `2code.json`; terminal sessions, scrollback, and window layout come back after a restart; agent state is read off the terminal output — a green dot when it's done, a yellow dot plus a sound when it's waiting on your call; built-in git diff and history keep review inside the same window.

We call it an **agent workstation**: one task, one desk, with its own worktree, terminal, and agent — you walk over to accept the work.

## Try it

If your current "parallel" is four Terminal.app windows plus a good memory, there's a different way to spend the afternoon:

```bash
brew install --cask akarachen/tap/2code
```

- Website: <https://2code.akr.moe/>
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>
- Further reading: [Git Worktrees as Agent Workstations: One Day in Parallel](/blog/worktree-as-agent-workstations) · [How Do You Know Your Agent Is Done?](/blog/how-do-you-know-your-agent-is-done)

More windows isn't wrong — it's the starting point. But the workflow starts beyond the windows: isolation, recovery, notification, and a review path that doesn't require archaeology.
