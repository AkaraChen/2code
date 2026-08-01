---
title: "How Do You Know Your Agent Is Done?"
description: "Once you run Claude Code and Codex in parallel, the problem isn't a slow model — it's that you don't know which one finished. A ladder for notification design, and which rung 2code actually reaches today."
date: 2026-08-05
publishAt: 2026-08-05T00:00:00+08:00
slug: how-do-you-know-your-agent-is-done
tags:
  [
    agent notifications,
    parallel agents,
    agent orchestration,
    agentic IDE,
    Claude Code,
    Codex,
    Superset,
    Orca,
    JetBrains Air,
    terminal workstation,
  ]
---

## Which pane are you refreshing?

Four terminal windows, four agents.

The first is refactoring an API and hasn't printed anything for six minutes. The second stopped mid-screen, and you can't tell whether it finished or is waiting for you to press `y`. The third you started this morning and you genuinely cannot remember what it's doing. The fourth just launched, so it's definitely too early.

So you start cycling. One lap, back to your editor, two lines of code, one more lap.

Your agents are parallel. **You are single-threaded** — and you're spending your one thread on the single thing computers are best at: **polling**.

## Polling costs more than you think

Every "let me just glance at it" is not a cheap tab switch. It's three things:

1. **Deciding to look** — the thought alone interrupts what you were doing.
2. **Rebuilding context** — where was this one? Is this output new, or did I already read it?
3. **Judging** — is it finished, stuck, or waiting on me?

Step three is the killer, because **it frequently has no answer**. A terminal shows characters, not state. An agent that has stopped and an agent that is thinking can look identical on screen.

Worse, the loop reinforces itself. The less sure you are, the more you want to check. The more you check, the slower your own work moves. The slower it moves, the more you think *well, I'm not concentrating anyway — might as well do another lap.*

The result is that the benefit of parallelism gets eaten. You launched four agents so you could **do something else while they work**. You didn't do something else. You babysat.

Put bluntly: **without notifications, parallelism just duplicates the waiting N times.**

## Notifications aren't a switch. They're a ladder.

There's an easy wrong turn here. You notice that people don't know when their agent is done, so you make every event a popup with a sound attached.

Two days later they turn it off in settings, because not every event deserves to interrupt you.

Ranked by how much they cost you, notifications form a ladder with roughly five rungs:

| Rung | Form | Interruption cost | Fits which event |
| --- | --- | --- | --- |
| 0 | Terminal title bar | Near zero, but you have to look | Raw state |
| 1 | Status dot in a list | Zero, readable at a glance | "It's done" |
| 2 | Sound | Low, but it pierces attention | "It needs a decision" |
| 3 | System notification | Medium, covers other windows | "You're away, but it needs you" |
| 4 | Phone push | High, crosses devices | "You're not at the computer" |

What matters isn't how high you climb. It's **putting each event on the right rung**.

Miss by one rung and the experience breaks:

- Make "it's done" a sound → four agents finish together and your machine becomes a slot machine.
- Make "it needs you" a quiet dot → that agent sits on a permission prompt for ten minutes, doing nothing.

So the real question isn't *should we notify*. It's: **why did the agent stop?**

## Two kinds of "stopped" deserve two kinds of treatment

An agent that stops has stopped for one of two reasons, and they mean completely different things to you.

**One: it finished.** The result is sitting there. So is the diff. Seeing it three minutes later costs you nothing. That's a piece of **information**, not an interruption.

**Two: it's waiting on you.** A permission prompt, a fork in the plan, a question that needs your answer. **It is doing zero work in that state.** Noticing ten minutes late means ten minutes burned — and with four lanes running, that idle time stacks.

The first should **stay where it is and wait for you**. The second should **come find you**.

A tool that can't tell them apart only gets to pick between too noisy and useless.

## Which rung 2code is on today

2code is a full terminal emulator — your shell, prompt, aliases, and CLI agents work exactly as they do now. What it adds on top is a layer of state detection, wired into that ladder.

**Detection: reading state out of characters.** 2code judges agent state from three sources: the terminal screen text, OSC title sequences, and OSC progress sequences. Most agent CLIs are already broadcasting their state — ordinary terminals just don't listen. Claude Code, for instance, sets its window title to a Braille-pattern spinner character while it works and swaps it for `✳` when idle; when it raises a permission prompt, the bottom of the screen carries "Do you want to proceed?" plus a numbered choice list. All of that is a signal you can match on.

The rules live in the repo as one manifest per agent, covering 18 today: Claude Code, Codex, Gemini, Cursor, Copilot, OpenCode, Amp, Cline, Devin, Droid, Grok, Kilo, Kimi, Kiro, Hermes, Pi, Qoder CLI, and Agy. Everything collapses into the two states that mean something to you: **running** and **waiting on you**.

**Rung 1 — the dot.** Every terminal tab, every workstation in the sidebar, and every project entry carries a dot:

- Running: a green dot, breathing gently.
- Waiting on you: a **yellow** dot.
- Finished: a **still green** dot that stays lit until you open that tab.

The sidebar rolls every tab under a workstation into one dot, and "waiting" outranks "running" — so that column of dots is the whole picture of your parallel lanes. **Finished makes no sound, because it isn't urgent.**

**Rung 2 — sound.** The moment an agent flips from running to waiting, it plays once. You pick the tone from your system's built-in sounds in settings (macOS reads `/System/Library/Sounds`, Windows `C:\Windows\Media`, Linux the XDG sound directories), with preview. **Only "needs a decision" plays. "Finished" never does.**

**Rung 3 — system notification.** Same moment, one extra condition: **it only fires when the 2code window is not in the foreground**. If you're already looking at the window, a banner telling you an agent wants input is noise, not news. The notification names which agent it is, with the tab name as the body, so you know which lane to return to without opening it.

The whole thing is **off by default**. Turning it on in settings asks the OS for notification permission; without that you still get dots and sound. Our take: anything that can make noise should be switched on by you, once, deliberately.

**Rung 4 — your phone.** Not there. More on that below.

## Boundaries: not an orchestration inbox, not a mobile app

Better to be precise than to oversell.

**Versus tmux.** tmux keeps sessions alive and can flag windows with activity — but that's "bytes moved", not "an agent needs you". A build spinning a progress bar and an agent frozen on a permission prompt are both just *activity* to tmux. 2code matches semantic state, not whether characters went by.

**Versus Orca.** Orca has a mobile companion, so you can see agent status away from your desk. That's rung 4, and 2code doesn't have it — nor is it on the near-term plan, because it needs a server-side channel, and 2code runs entirely on your own machine today. So the positioning is narrow on purpose: **it covers "you're at your computer with your attention elsewhere", not "you're on the train".**

**Versus Superset.** Superset is solving orchestration and review gates for dozens of agents — an inbox, a queue. 2code doesn't build a queue. It makes sure **the three or four lanes on your desktop can reach you when something happens.**

**Versus a Slack bot.** Posting "task complete" into Slack costs you a trip out of the workstation and back. The result was already in 2code; what you actually want to do is scan a diff, not read a message. So we don't send anything outward. We light it up in place.

This is a minimum viable loop, not a complete answer. But it deletes the one action you perform dozens of times a day: **switching over to check.**

## Try it

If you recognize this afternoon —

You start four lanes and **actually walk away**. Two sounds in twenty minutes: the refactor asking whether it should touch the database schema, and the test lane asking for permission. You handle both. The other two are sitting on still green dots when you get back — they finished a while ago and didn't bother you about it.

```bash
brew install --cask akarachen/tap/2code
```

- Website: <https://2code.akr.moe/> ([中文](https://2code.akr.moe/zh-cn))
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>

**Which rung do you want next?** Phone push, or something smarter like "jump me to the next lane that needs attention"? The detection manifests are in the repo too (`src/features/terminal/detector/rules/`) — if your agent isn't recognized, open an issue or send a PR. One more manifest is one more agent that can raise its hand.

A good workstation doesn't make you watch more closely. It makes watching unnecessary.
