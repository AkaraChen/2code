---
title: Why I'm Not Building a 100-Agent Factory First
description: Orca says Ship 100x. Superset's goal is 100 parallel agents per person by the end of 2026. The direction is right — but even they reliably run 5–7 today. As a solo developer I'd rather make two or three lanes work properly. Here's the tradeoff list.
date: 2026-08-05
publishAt: 2026-08-05T09:00:00+08:00
slug: why-im-not-building-an-agent-factory
tags:
  [
    parallel agents,
    agent orchestration,
    indie development,
    product tradeoffs,
    Claude Code,
    terminal workstation,
  ]
---

## Everyone is shouting a number right now

Open the homepages of this generation of tools and the headlines all point the same way:

- Orca: **"Ship 100x With The Agent IDE"**, built around "a fleet of agents", with a testimonial on the front page that reads "Orchestrating 600 agents from my phone".
- Superset: **"Run 10+ parallel coding agents on your machine"**, plus a published roadmap whose goal is **100 parallel agents per person by the end of 2026**.

I read those pages carefully, and I genuinely think the direction is right — the marginal cost of an agent really is falling. That Superset roadmap has a very clear-eyed line in it: *"Agent compute is already cheap enough, you can run hundreds of agents a month all for less than the cost of one engineer."*

So this isn't a takedown. I just want to be precise about why, as a solo developer building a tool, **I'm not building that layer first**.

## Start with one number: even they run 5–7

The most honest part of that same roadmap is its opening:

> *"Right now at Superset, we're able to reliably manage 5-7 coding agents in parallel... Our goal is to be able to manage 100 coding agents in parallel each by the end of 2026."*

> *"What's stopping us is every agent needs a human to review its code, give feedback, and decide what to work on next. Scale the agents all you want - it's the humans that don't scale."*

> *"Right now, most of our agents spend more time waiting for us to review their work than they spend doing it."*

Read that again. A company whose entire product is parallel orchestration reliably runs **5 to 7** today, and most of their agents spend more time waiting on a human than working. 100 is the goal, not the status quo — they say so themselves.

So: what's your number?

Don't guess. Count it. Count the task lanes you actually had running *and followed through on* last week. Not "how many terminal windows did I open" — how many lanes did you actually read the diff for and make a call on.

My own number is single digits: two or three on an ordinary day, a couple more when it's busy. 2code is designed for that number.

Here's the part that's easy to miss: **your parallelism isn't capped by model quality, it's capped by how much review you can digest.** Every lane ends with a human scanning a diff and deciding whether it ships. Spinning up ninety more agents does not make that step faster — which is exactly Superset's own point: "You can't review 100 diffs a day."

The 100-agent factory is a team-scale goal that requires automating review itself. It's worth building. It just isn't the problem in front of me today.

## The four things that actually slow me down

If my real concurrency is two or three lanes, where does my day actually go? I wrote it out once. It's these four:

**1. Recovery.** Quit the app, reboot the machine, come back the next morning — are those three lanes still there? The code is, obviously; it's all in git. What's gone is *which lane was doing what, how far it got, and what comes next*. Every restart means re-excavating. I pay that cost several times a week.

**2. Notification.** The agent finished. Who tells me? Nobody, unless something does — so I become the poller, cycling through windows every couple of minutes to see who's done. Three lanes is already enough polling that I don't dare leave my desk. And "go do something else while the agent works" was supposed to be the entire point of running things in parallel.

**3. The distance to review.** The agent says it's done. How many app switches sit between that sentence and "I've seen the diff and made a decision"? Terminal → editor → git GUI → back again. I walk that path a dozen times a day.

**4. Context switching.** Stack the three above and you get a day chopped into fragments — not by the agents, but by **the gaps between tools**.

Notice what those four have in common: **none of them are about how many lanes you run.** They hurt with one lane too. Scaling to 100 makes them hurt more, but the number was never the root cause.

That's my call: for a solo developer, the thing that kills you first isn't "I can't schedule 100 agents." It's those four gaps.

## The 2code tradeoff list

So 2code is built around those four things, and **only** those four things.

What it does:

- **Persistent terminals and restore.** Terminal sessions, scrollback, and window layout come back after a restart. You return to what you left, not to blank panes.
- **Agent status detection.** It reads terminal output, OSC titles, and progress sequences to tell whether an agent is running, waiting on you, or finished — then lights a green dot and plays a sound when it lands. Polling becomes push.
- **Worktree lanes.** Each worktree gets its own window and its own terminal context. Profiles live under `~/.2code/workspace/{id}`, run the setup script you defined in `2code.json` on creation, and run teardown on delete.
- **Built-in git and a light editor.** Diffs, staged changes, and commit history live in the same app, so a quick config tweak doesn't cost you an app switch.

What it deliberately does not do — not now, and not soon:

- **No task scheduler or queue.** 2code doesn't decide which agent runs next, or on what.
- **No automated review gate.** There is no "agent commits → lint/test gate → merge" pipeline. Review is still yours; 2code just drags it as close to you as it can get.
- **No cloud runners, no remote fleet.** Everything runs on your machine.
- **It isn't an IDE.** The editor goes as far as "fix this one line" and no further. I'm not trying to take your editor's job.
- **macOS first.** Windows and Linux are experimental, and some of the Windows system-customization surface is still being validated.

I know that list reads as *small*. But small and deliberate are different things — every line in the "does not" column is there because it serves a different layer of the problem, not because it hasn't come up the queue yet.

One reference I keep coming back to: when JetBrains wrote about winding Fleet down, the valuable part wasn't what they said they'd build. It was what they said they'd **stop** building. A tool's honesty usually shows up in that list.

## When you should go use Orca or Superset

I want to write this section more carefully than the part where I praise my own thing.

**Go use an orchestrator if:**

- You're a team that needs to hand tasks out to a pool of agents instead of starting each one by hand.
- Your bottleneck is provably "review doesn't scale", and you need automated gates, batch diff review, and cross-task scheduling policy.
- You genuinely need dozens or hundreds of lanes — bulk migrations, large-scale refactors, racing several approaches and picking a winner.
- You want 25+ agents preconfigured and sitting side by side for comparison.

**Use 2code if:**

- Your real concurrency is 2–5 lanes, and what's left hurting is recovery, notification, and the distance to review.
- You want a workstation you leave open all day, not a system you have to configure a workflow into before you can start.
- You live in the terminal and want your CLI agent running where it already belongs, instead of stuffed into a side panel.

These aren't mutually exclusive. The workstation is the floor; orchestration is the layer above it. **When the floor is uneven, the layer above pays for it** — an orchestrator can spin up fifty agents for you, but something still has to tell you whether the three on your own desktop are done.

The day my own real concurrency goes from 3 lanes to 30, I'll think hard about that upper layer. Until then, promising 100 would be dishonest.

## Make three lanes work first

If you counted your own number and it also came out at two or three — and what actually hurts is re-excavating after every restart, not daring to leave your desk, and the diff being too far away — then we're solving the same problem.

```bash
brew install --cask akarachen/tap/2code
```

- Site: <https://2code.akr.moe/>
- GitHub: <https://github.com/AkaraChen/2code> — open source, issues and stars welcome
- Latest release: <https://github.com/AkaraChen/2code/releases/latest>

2code is early and still moving. But what it promises is small: make the two or three lanes you actually have today stop costing you attention.
