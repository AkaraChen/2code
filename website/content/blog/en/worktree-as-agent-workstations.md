---
title: Git Worktrees as Agent Workstations: One Day in Parallel
description: One repo and one working copy is not enough once agents run for minutes at a time. Treat each Git worktree as an agent workstation — open three task lines in the morning, review diffs at noon, merge one and park one in the afternoon, and keep the scene after restart.
date: 2026-08-02
publishAt: 2026-08-02T00:00:00+08:00
slug: worktree-as-agent-workstations
tags:
  [
    Git worktree,
    agent workstation,
    swimlane,
    parallel agents,
    Claude Code,
    terminal workstation,
  ]
---

## 9:00 a.m. — one repo, three desks

I open 2code and do not start by writing code. I start by opening workstations.

Today I need three things moving at once:

1. **Bugfix** — an intermittent 500 in production, already narrowed to one query
2. **Feature** — an export button on the settings page; ideally a draft PR by tonight
3. **Experiment** — a different caching approach; might fail; must not pollute the main line

I used to juggle this on a single checkout, or open three Terminal windows and hope I remembered that the left one was the bugfix.

The default is different now: **one task = one agent workstation = one Git worktree**.

In 2code, a workstation is a profile: create it and you get `git worktree add` under `~/.2code/workspace/{id}`, with its own branch, its own terminals, and optionally its own dev server. Setup lives in the project's `2code.json` — `npm install`, for example — so a new workstation boots with dependencies already in place.

By 9:15, three task lines are live: bugfix / feature / experiment. Each workstation gets a CLI agent (Claude Code or whatever you already use). The two that need hot reload also get a dev server. Then I give my attention to something only I can do: read the issue, answer messages, finish the design note that was actually due first.

The agents work at their desks. I am not staring at them.

## Why one working copy breaks down

Classic Git assumes you do one thing at a time: check out a branch, change it, commit, move on.

Agents break that assumption.

An agent can run for ten or twenty minutes. It edits files, runs tests, loops. If you start a second agent in the **same working tree**, you usually get:

- two agents touching the same files until the diff is soup
- a branch switch for a fire drill that drags the first agent's half-finished tree with it
- a port already bound, and no clear owner for which process to kill
- a merge where you cannot tell which line belonged to which job

Worktrees are not advanced Git flex. They state something that should have been obvious: **parallel tasks need parallel working copies**.

The man page is [git-worktree](https://git-scm.com/docs/git-worktree). Short version: one repository, multiple checkouts, shared object store, separate directories and branches. For agents, that means each task line has its own filesystem scene — no stepping on each other.

I keep it as:

> **Workstation = isolated worktree + terminal + agent (+ optional dev server)**

In product English you may also say *swimlane*. Same idea: each agent sits at its own desk; you walk over to accept the work instead of everyone fighting for one keyboard.

## Noon — a green dot, then the diff

At 11:30 a workstation lights a green dot in the sidebar. A sound plays.

I do not cycle four Terminal.app windows by hand. 2code reads agent state from terminal output, titles, and progress sequences — done comes to find you, instead of waiting for you to go looking.

I open the bugfix workstation and the built-in git diff.

The agent says it fixed the bug. The diff says: query change, new test, and a "drive-by cleanup" of an unrelated helper. I drop the last one, keep the first two, add two lines of comments, run the related tests, merge to main.

The other two are still running. I leave them alone.

That is the real savings from parallel work: **you leave to do something else; completion comes back to you; the result sits next to the workstation, not across three apps you have to excavate.**

## Afternoon — merge one, park one, survive a restart

At 2:00 the feature line lights up. The diff is clean. I review it and open a draft PR.

The experiment is still dumping logs; the caching idea looks wrong. I do not kill it yet — I have a meeting. The workstation stays, the scrollback stays, the agent session stays. When the meeting ends, the scene is not three empty windows and a round of `git status` archaeology.

At 4:30 I close the laptop. When I open 2code again:

- three workstations are still in the sidebar
- each still has its terminal history
- unfinished edits still live in their own worktrees
- I still know (and the app still knows) which line is the experiment and which already has a PR

Persistent terminals and session restore are not a nicety here. They are the floor of a parallel workflow. **Leave and come back: workstations stay workstations, not three black boxes you have to re-claim.**

## The same day as concrete 2code moves

| When | What you do | What carries it |
| --- | --- | --- |
| Morning | Create 2–3 profiles by task | Worktree workstations (branch + directory) |
| Morning | Start agent / dev server per workstation | Persistent terminals + command templates |
| Daytime | Go do something else | Agent completion dots / sound |
| On done | Scan the diff, small fix, merge or drop | Built-in git diff |
| After interrupt | Close lid, switch project, open tomorrow | Session and layout restore |
| Wind-down | Delete the experiment workstation | Teardown script + worktree cleanup |

You do not need fifty agents. **Two or three real task lines for a full day** is enough — and already enough to expose what a plain terminal cannot hold.

## When to stop the agent, when to edit yourself

Parallel does not outsource judgment. My heuristics are boring and useful:

**Let the agent keep running if:** the task boundary is clear (repro + acceptance criteria), a failed run is cheap, and you cannot spare a full block of attention yet.

**Take over if:** the diff starts "refactoring while here," the same test fails a third time, or you can already write the correct patch in three sentences. The most expensive agent moment is rarely tokens — it is watching it take the wrong turn again while you wait politely.

**Close the workstation if:** the experiment is falsified, or the direction changed. Half-finished worktrees tax attention. Delete the profile, let teardown run, clear the directory and branch, clear your head.

A workstation's value is not only that work can run in parallel. It is that work can **end cleanly**.

## Pitfalls you will hit

**Dependencies, times N.** Each worktree is its own working directory. `node_modules` does not appear by magic. Put `npm install` / `bun install` in `2code.json` setup so you are not reinstalling from memory on every line.

**Port collisions.** Three lines all binding `localhost:3000` means the later ones die. Give the experiment another port, or agree that only one UI is hot at a time. Workstations isolate the file tree, not your port table.

**Merge order.** Merge the small, low-conflict line first. Experiments go last, or never. When all three branched from the same point you are fine; after a long day, rebase or merge main before the agent keeps working on a stale base.

**Do not parallelize for its own sake.** Splitting one coherent task into three agents often costs more in review than it saves in wall clock. Workstations are for work that was already going to run in parallel — not a productivity KPI.

## Try it for one day

If you want a minimal test of the model:

1. Install 2code (macOS):

```bash
brew install --cask akarachen/tap/2code
```

2. Add a real project you are already in
3. Open **two** workstations: one for the bug in front of you, one for the side task you were going to context-switch into anyway
4. Start an agent in each, then force yourself to leave for twenty minutes
5. Come back only when a green dot lights; look at the diff; merge, patch, or drop

If step 4 has you polling windows, the old habit is still in charge. If step 5 lets you finish review inside one app, the workstation model is starting to work.

- Website: <https://2code.akr.moe/> ([中文](https://2code.akr.moe/zh-cn))
- GitHub: <https://github.com/AkaraChen/2code>
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>
- `git worktree` docs: <https://git-scm.com/docs/git-worktree>

What the agent era needs is not more windows. It needs a desk per task. The worktree is that desk. "Workstation" is just the word we say out loud.
