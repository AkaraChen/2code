---
title: "Git Worktree: A Concise Guide, Rewritten for AI Agents"
description: "A zero-prerequisite git worktree tutorial: what it is, why parallel agents need it, the three commands that matter, the four pitfalls you will hit, and when not to use it."
date: 2026-08-07
publishAt: 2026-08-07T00:00:00+08:00
slug: git-worktree-guide-for-ai-agents
tags:
  [
    Git worktree,
    git worktrees,
    git worktree ai agent,
    git tutorial,
    parallel coding agents,
    Claude Code,
    Codex,
    Superset,
    Orca,
    terminal workstation,
  ]
---

## Why this guide exists

`git worktree` sat in Git for ten years as an obscure feature — until AI agents made it a daily tool.

The reason is simple: point two agents at the same repository and they will edit files at the same time. Switching branches cannot fix that, because the entire history of branch switching assumes **you have exactly one working directory**.

Worktrees break precisely that assumption. This guide covers only what you need: one concept, three commands, four pitfalls. You can follow along as you read.

## What a worktree is: one repository, several working directories

A normal repository looks like this: one directory, one copy of the code, one branch checked out at a time.

A worktree lets the same repository own **several working directories**, each on a different branch, all sharing a single `.git` object store:

```
                ┌──────────────────────────┐
                │  .git object store (one) │
                │  every commit and branch │
                └────────────┬─────────────┘
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ~/code/my-app     ~/code/my-app-fix    ~/code/my-app-exp
   branch: main      branch: fix/login    branch: exp/cache
   you, editing      agent A works here   agent B works here
```

Three things matter:

1. **No re-clone.** The new directory shares the object store. Creation is instant and costs no duplicate history.
2. **Files stay invisible to each other.** Three directories are three independent file trees. Whatever an agent changes in one never touches another.
3. **`.git` in the new directory is a file**, not a folder — just a pointer back to the main repository. That is how "shared history, separate files" can both be true.

The official docs live at [git-worktree](https://git-scm.com/docs/git-worktree). What follows is the minimum useful version.

## Why branch switching is not enough

You might wonder: for parallelism, why not just cut more branches?

Because **branch switching shares one working directory**. The moment you `git checkout` another branch, Git rewrites the files on disk wholesale. For a human that is mildly annoying; for an agent it is a disaster:

- An agent runs for ten-plus minutes and touches files the whole time. Switch branches under it, and its half-finished working tree falls apart.
- Two agents in one directory are two workers grabbing the same desk. When both edit a file, the diff turns to porridge, and you can no longer tell which line served which task.
- Uncommitted changes travel with the checkout. You switch away to fight a fire, and the working tree you come back to is not the one you left.

In one sentence: **branches isolate history; worktrees isolate files.** Parallel agents need the latter.

## The minimal command set: add / list / remove

Three commands cover daily use. Say you are in `~/code/my-app`:

**Create one.** Open a working directory for "fix the login 500," with a fresh branch:

```bash
git worktree add ../my-app-fix -b fix/login-500
```

The convention is to put the new directory **next to** the main repo (`../`), never nested inside it. To check out an existing branch instead of creating one, drop the `-b`:

```bash
git worktree add ../my-app-release release/1.4
```

**See what exists.** Take stock any time:

```bash
git worktree list
```

**Remove one.** When the task is done, back in the main repo:

```bash
git worktree remove ../my-app-fix
```

If the directory still has uncommitted changes or untracked files, Git refuses — that is protection, not a bug. If you are sure, add `--force`. The branch itself survives; only the working directory goes away.

One more first-aid command: if you got impatient and `rm -rf`'d the directory, Git's records are still around. `git worktree prune` cleans up the corpse.

That is all of it. Everything else is about how you use it.

## The agent pattern: one task, one worktree

With those three commands, the standard pattern for parallel agents falls out:

1. For each task, `git worktree add` a directory plus a branch.
2. Point the agent at **that directory** (Claude Code, Codex, or whichever CLI you like — just start it there).
3. Go do something else. When it finishes, review the diff in that directory, run the tests, and merge or open a PR if you are happy.
4. `git worktree remove`, and move on.

Every task line gets its own file tree, its own branch, its own diff. At review time you always know "which task was this change for," because branch and task map one-to-one.

For how a day of three such lines actually flows, see the companion piece [Using Worktrees as Agent Workstations: A Day of Parallel Work](/blog/worktree-as-agent-workstations). This guide stays focused on the tool itself.

## Four pitfalls you will hit

**One: `node_modules` does not come along.** A new working directory is a clean checkout; anything `.gitignore`d is simply absent, so dependencies need reinstalling. One copy per worktree does cost disk — that is a real cost of the model. Accept it, or script it (below).

**Two: `.env` does not come along either.** Env files are usually ignored too, so the new directory has none. Either `cp .env ../my-app-fix/` by hand, or put `cp .env.example .env` in a setup script. When an agent fails to boot with a pile of "undefined environment variable" errors, this is the cause eight times out of ten.

**Three: ports are not isolated.** Worktrees isolate the file tree, not your port table. Two lines both binding `localhost:3000` means the second one dies. Give each line its own port, or agree that only one UI runs hot at a time. Databases, Docker containers, and global caches are the same story — they are **shared state**, which worktrees do not govern.

**Four: submodules need re-initializing.** If the repo has submodules, every new worktree needs a `git submodule update --init`, or the submodule directories sit empty.

A bonus error you will see: `fatal: 'xxx' is already checked out at ...`. Git will not let two worktrees hold the same branch — that is exactly the foot-gun it takes away from you. Pick another branch name.

## When not to use worktrees

Honestly, the tool is not universal:

- **Solo, one agent, one thing at a time:** plain branches are fine; a worktree is pure overhead.
- **A two-line fix:** creating a directory, installing dependencies, and tearing it down takes longer than the change.
- **Environment-level isolation:** different dependency versions, different databases, different system config — worktrees isolate files only. Reach for containers or cloud dev environments.
- **Huge repos with very slow installs:** one `node_modules` per worktree will cost you before it pays you. Check disk and time first.

## Manual vs. tooling

Three commands typed by hand comfortably cover one or two lines. Add more lines, and the repetition shows: create directory, name branch, install deps, copy `.env`, clean up — once per task.

That is exactly the layer tools are building, each in its own way:

- **2code** (our workstation) turns worktrees into "workstations": creating a profile runs `git worktree add` into `~/.2code/workspace/{id}` with a matching branch; a `2code.json` at the project root declares `setup_script` entries (say, `npm install`, `cp .env.example .env`) that run in order when a workstation comes up; deleting one runs `teardown_script` and then `git worktree remove`. Pitfalls one and two above get absorbed by that script.
- **Superset** targets larger fleets: queues and review gates for dozens of agents, with worktrees as the isolation layer underneath.
- **Orca** packages "task = worktree + agent terminal + browser" as one unit, with a fleet-management bent.

The common ground: nobody invented new isolation technology. Everyone wired a ten-year-old Git feature into agent-era daily work. The difference is only how many lines you need to run.

## Try it yourself

The minimal path: pick a repo you are actively working in, and open one line right now:

```bash
git worktree add ../my-app-try -b try/first-worktree
```

Hand the agent some small task you were going to do anyway, then go do something else. Half an hour later, glance at `git worktree list`, then `git worktree remove` to close out. That is the whole lifecycle.

If the manual flow feels fiddly — or you would also like to solve "the agent finished and nobody told you":

```bash
brew install --cask akarachen/tap/2code
```

- Website: <https://2code.akr.moe/> ([中文](https://2code.akr.moe/zh-cn))
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>
- `git worktree` docs: <https://git-scm.com/docs/git-worktree>

Worktrees were never hard. They just waited ten years for a scenario that needed them.
