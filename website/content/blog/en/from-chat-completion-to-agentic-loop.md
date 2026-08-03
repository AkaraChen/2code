---
title: "From Chat Completion to the Agentic Loop: What Actually Changed"
description: "Completion and chat are synchronous short loops; the agentic loop is an asynchronous long one. The conclusion JetBrains paid for with Fleet, and how your keyboard habits concretely change."
date: 2026-08-06
publishAt: 2026-08-06T00:00:00+08:00
slug: from-chat-completion-to-agentic-loop
tags:
  [
    agentic loop,
    chat completion,
    agentic IDE,
    Claude Code,
    Codex,
    JetBrains Air,
    Fleet,
    Superset,
    terminal workstation,
  ]
---

## One gesture changed

In 2022, the signature gesture of AI coding was **tab**. Copilot painted gray text, you pressed tab to accept, your hands never left the keyboard. One loop took seconds.

In 2023, the gesture became **Cmd-K**. Select some code, say what you want in plain language, wait a few seconds, take the diff or the code block. Still synchronous: while it generated, you waited.

Since 2025, the gesture is **write a paragraph, hit enter, and walk away**. The agent runs for ten minutes, half an hour, and hands you back a complete patch.

On the surface the wait just got longer. What actually flipped is your relationship with the tool: in the first two phases, AI orbited your cursor. In the third, you orbit its output. JetBrains gave the third phase a name: the **agentic loop**.

## Three phases, one curve

Compress developer–AI interaction from 2022 to 2026 and you get roughly three phases:

**Completion.** The unit is the next line. The model reads the context around your cursor and guesses what you meant to type. It doesn't execute tasks; it saves keystrokes.

**Chat and inline edit.** The unit is the conversation. You describe a local problem, it gives a local answer. You feed context by hand: select, paste, @-mention files.

**The agentic loop.** The unit is a task. You define the goal and the acceptance criteria; it decomposes, runs commands, edits files, runs tests, and returns a change you can review.

The dividing line isn't "models got better" — they did, but the real change is **the structure of the loop**. The first two phases are synchronous short loops: you initiate, you wait, you accept, all inside the editor, in seconds. The third is an asynchronous long loop: after you initiate, the most valuable move is to **go do something else**.

## Synchronous vs asynchronous is not just speed

| | Synchronous short loop (completion / chat) | Asynchronous long loop (agentic loop) |
| --- | --- | --- |
| Unit of interaction | Cursor position, this conversation | A task |
| Time scale | Seconds | Minutes to hours |
| Your role | Typist + instant judge | Task definer + after-the-fact reviewer |
| Execution environment | Your one working copy | Isolated environments (worktrees / containers), several in parallel |
| Output | A few lines, a suggestion | A complete patch, review-first |
| Cost of getting stuck | A few impatient seconds | It idles for ten minutes and you don't notice |

The most underestimated row is the last one. In a synchronous loop, getting stuck costs you a few seconds of impatience. In an asynchronous loop, it costs you the fact that **you don't know it's stuck at all**. That problem deserves its own post, and we wrote it: [How Do You Know Your Agent Is Done?](/blog/how-do-you-know-your-agent-is-done)

## The conclusion JetBrains paid for with a product

In December 2025, JetBrains announced that Fleet would stop being distributed. The official post contains a paragraph worth reading in the original, because it was paid for with a product line:

> The agentic loop relies on structured task definition, context assembly, multiple asynchronous runs, isolated execution, and review-first workflows.

Some background: JetBrains first tried positioning Fleet as an AI-first editor, then dropped the idea — the market already had plenty of AI-first VS Code forks, and one more would not stand out. Their conclusion was that the classic IDE workflow and the agentic loop **crammed into a single tool produce a disjointed experience** (their words).

What happened next is public: the Fleet team pivoted to Air, an environment rebuilt around agents. Air's launch post states the division of labor plainly:

> IDEs add tools to the code editor, while Air builds tools around the agent.

And one line that matters even more: **Air handles the agent-powered development; your IDE handles the rest.** Not a replacement for your IDE — it takes over the half your IDE can't hold. You can see the thinking in the details too: when you define a task in Air, you can reference a specific line, commit, or symbol, so the agent gets precise context instead of a blob of pasted text.

Enough quoting. What those two posts are really worth is that they explain *why the tooling had to fork*: it's not that editors aren't smart enough — **a synchronous tool and an asynchronous task are structurally different things**. The cursor is centered on *now*; a task is centered on *some future moment of completion*. One interface struggles to center on both.

## How your keyboard habits change, concretely

This is the point where paradigm essays go abstract. So here are actions only — hold them against your own day.

**Task definition replaces cursor positioning.** You used to walk to the bug, select, Cmd-K. Now you write a paragraph: goal, constraints, acceptance criteria — and send it. Air's own dogfooding notes admit that agents are bad at code design, architecture, and following project patterns, so their engineers set up the structure themselves and let the agent finish. Every sentence you skip in the task definition comes back double at review time.

**Opening an isolated environment replaces switching branches.** Async means parallel, and parallel means the agent can't edit your main working copy directly. The concrete move: open a worktree (or a container) for the task and let it run inside. Two agents in one directory will trample each other — Superset's [orchestration post](https://superset.sh/blog/agent-orchestration-not-another-agent) calls this the isolation problem, and it's why git worktrees, a feature over a decade old, are suddenly fashionable.

**Waiting for a notification replaces watching the screen.** In a synchronous loop, waiting is the default posture. In an asynchronous loop, watching is the worst one — you pay the cost of parallelism without collecting the benefit. The right move: start the task, physically leave, and let "it's done" or "it needs you" come find you as a notification.

**Scanning diffs replaces watching it type.** Review-first means the first time you see the agent's output, it's already a complete patch. Your motion changes from "watch it generate" to "scan the diff, decide merge or not; if not, write one review comment and let it run another round." Your judgment is finally worth more than your typing speed.

**Merging replaces copy-pasting.** The last step of the chat era was pasting a code block into your editor. The last step of the agentic loop is merging the worktree back into your main copy and clearing the lane.

Count them: five actions, none of which happen at a cursor position. That's what "a cursor-centered tool will feel disjointed" actually means — the editor isn't useless; it's just that more and more of your day never passes through a cursor.

## Where 2code sits on this curve

First, what 2code is not: not an IDE, not an editor, and not an "AI-first editor" either — JetBrains already ran that experiment for everyone.

2code is a terminal workstation. It carries the **"on the ground" half** of the agentic loop. CLI agents — Claude Code, Codex, and friends — actually live in the terminal, and those five actions map onto 2code like this:

- **Isolated environments** → worktree windows: every worktree gets its own window with its own terminals and context. Creating one runs the setup script you define in `2code.json` — no manual environment prep.
- **Waiting for notifications** → agent status awareness: 2code reads agent state from terminal output, title sequences, and progress sequences. Running is a gently breathing green dot; finished is a still green dot that waits quietly; only "needs your decision" makes a sound.
- **Scanning diffs** → built-in git: diff, staging area, and commit history sit next to the terminal. Reviewing doesn't require an app switch.
- **The scene survives** → persistent terminals: close the laptop, restart the app, and sessions plus layout come back the way you left them. An async loop runs tens of minutes; losing the scene midway means restarting the task.

Task definition is the one step 2code deliberately doesn't touch — that's between you and your agent, inside the agent's own interface. Tools should have edges.

## Further reading

The cognitive staircase of this post is borrowed from these primary sources, all worth reading in full:

- [The Future of Fleet](https://blog.jetbrains.com/fleet/2025/12/the-future-of-fleet/) — JetBrains' official note on ending Fleet, and the source of the agentic loop's five traits
- [Air Launches as Public Preview](https://blog.jetbrains.com/air/2026/03/air-launches-as-public-preview-a-new-wave-of-dev-tooling-built-on-26-years-of-experience/) — "IDEs add tools to the code editor, while Air builds tools around the agent"
- [My Journey to Agent-First Development with Air](https://blog.jetbrains.com/air/2026/04/my-journey-to-agent-first-development-with-air/) — the Air team's dogfooding notes, full of first-hand detail on who does what, human or agent
- [You Don't Need Another AI Coding Agent](https://superset.sh/blog/agent-orchestration-not-another-agent) — Superset on why the bottleneck is the workflow, not one more agent

## Try it

If your gestures are still from the first two phases — tab, Cmd-K, copy-paste — that's nothing to be ashamed of; the synchronous loop is still the fastest tool for local problems. But if you've started "write a paragraph, hit enter, walk away," then what you need has already changed: a scene that opens lanes, calls you when needed, and keeps the diff within reach.

```bash
brew install --cask akarachen/tap/2code
```

- Website: <https://2code.akr.moe/> ([中文](https://2code.akr.moe/zh-cn))
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>

The cursor is yours. The task is theirs.
