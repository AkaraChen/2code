---
title: "The Myth: \"Worktrees Are Too Heavy — Branches Are Enough\""
description: "Branch switching shares a single working directory, so two agents editing files at once will trample each other. A worktree is one object store with multiple working directories — it isn't showing off, and the heavy part has long been automated away."
date: 2026-08-10
publishAt: 2026-08-10T00:00:00+08:00
slug: git-worktree-too-heavy-branch-enough
tags:
  [
    Git worktree,
    git worktrees,
    git branch,
    parallel agents,
    parallel coding agents,
    Claude Code,
    Codex,
    Superset,
    Orca,
    JetBrains Air,
    agent workstation,
    terminal workstation,
  ]
---

## The myth, verbatim

> "Git worktrees are too heavy. An extra directory, another dependency install, more paths to remember — I just want two agents working at the same time. Isn't two branches enough?"

It sounds reasonable, because branches really are light: `git switch -c`, done in a second. And "worktree" sounds like "cloning the repo all over again."

But the comparison is mismatched from the start: **branches and worktrees isolate different layers.**

## One picture: what actually differs

```text
branch switching: one working directory, playing one branch at a time

  ~/repo/                  ← the only working directory
    currently feature-a
    git switch hotfix → same directory, contents replaced by hotfix

worktrees: one object store, several working directories at once

  .git/ (a single object store — no duplicated history)
    ├── ~/repo/            ← main
    ├── ~/repo-feature/    ← feature-a
    └── ~/repo-hotfix/     ← hotfix — three directories, all present
```

`git switch` swaps branches by replacing the files in **one shared working directory**. There is a single directory, and "which branch it currently is" is mutually exclusive.

`git worktree add` checks out another directory from **the same object store**. History and objects are fully shared — the only extra disk cost is the working files — but now there are two directories, each on its own branch, **present at the same time**.

This is no new toy. Worktrees shipped in Git 2.5 back in 2015, built for people who had to drop half-finished work to fix an urgent bug. The feature spent a decade waiting for parallel agents to become its obvious use case.

## Fairness first: when a branch really is enough

One person, one agent, one thing at a time — in that setup, "worktrees are too heavy" is correct.

You watch the agent while it runs, commit, then switch to the next task. The whole workflow is serial, and a single working directory has no problem at all. Adding worktrees here really does just add a directory to remember.

The test is one sentence:

**At any given moment, are there two things that write files working in the same directory? If not, a branch is enough. If yes, it isn't.**

## Parallel agents: branches isolate exactly the layer agents don't work in

An agent doesn't read code — it **edits** code, for ten minutes or more at a stretch.

Two perfectly ordinary scenarios:

**One agent plus you.** Agent A is halfway through a change when an urgent bug lands, and you want to fix it yourself. The moment you `git switch`, the ground shifts under A: the files it just read now have different contents, its uncommitted changes either block the checkout or get carried into the other branch, and the test suite it left running is now executing against a directory it no longer recognizes.

**Two agents.** Two writers fight over the same files and the diff becomes porridge. `git status` can't tell you which line came from which agent, or for which task. Dev servers collide on ports, and you can't tell who started which process or which one to kill.

The root cause: **branches isolate commit history, not the filesystem. Agents live in the filesystem.** You're using a history tool to solve a working-directory conflict — wrong layer.

## Which part is actually "heavy"

Break it down and the worktree itself is not heavy at all: `git worktree add ../repo-fix fix` is one command, the object store is shared, and there is no second clone.

What's genuinely heavy is the **environment**: `node_modules` needs installing again, `.env` needs copying, ports need staggering, and the whole thing needs deleting when you're done. Done by hand, that's a few extra minutes per task line — and easy to forget. When most people say "worktrees are too heavy," this is the part they're actually complaining about.

And this part is exactly what tooling should absorb:

- **Scripts**: wrap setup and teardown into two commands, so creating and cleaning up no longer rely on memory;
- **2code workstations**: creating a workstation runs `git worktree add` for you and executes the setup written into the project's `2code.json` (say, `npm install`); deleting it runs teardown and removes the directory and branch together. Once the heavy part is automated, only the upside is left.

For the record, this isn't just 2code's opinion. In Orca, a task is a worktree. JetBrains Air offers exactly three run environments: Local Workspace, Git Worktree, Docker. Superset's entire parallel model is built on worktrees too. Several tools independently settled on the same isolation unit because a worktree is precisely "just isolated enough" — **harder than a branch, lighter than a clone or a container.**

So the cost equation runs in reverse: a branch saves you a few one-time minutes of environment setup, and costs you half an hour every time a parallel run collides. Once tooling erases the setup cost, the "lightness" of branches only holds in a serial workflow.

## Further reading

To put worktrees into a real day of parallel work, continue with the companion piece, [Git Worktrees as Agent Workstations: One Day in Parallel](/blog/worktree-as-agent-workstations) — three task lines running all day, and you come back to scan diffs when the green dot lights up.

```bash
brew install --cask akarachen/tap/2code
```

- Website: <https://2code.akr.moe/> ([中文](https://2code.akr.moe/zh-cn))
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>
- `git worktree` docs: <https://git-scm.com/docs/git-worktree>

Worktrees aren't heavy. **Two writers squeezed at the same desk — that's heavy.**
