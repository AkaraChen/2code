---
title: How We Built a Terminal Workstation with Tauri
description: A tour of 2code's stack — Tauri 2, React 19, a four-crate Rust workspace, xterm.js — and why PTY output moved out of SQLite into plain files.
date: 2026-08-06
publishAt: 2026-08-06T09:00:00+08:00
slug: building-a-terminal-workstation-with-tauri
tags:
  [
    Tauri,
    Tauri 2,
    Rust,
    Electron,
    xterm.js,
    PTY,
    terminal emulator,
    React,
    open source,
    git worktree,
    terminal workstation,
  ]
---

2code is an open-source desktop terminal workstation: terminals, AI CLI agents, Git, and worktree lanes living in one app. This post is its engineering anatomy — how we picked the stack, how we solved the three hardest problems in the terminal layer, and where we're still fighting bugs. Every path mentioned links into [the repo](https://github.com/AkaraChen/2code) so you can read along.

## Module boundaries first

```text
┌─────────────────────────────────────────────────┐
│ Frontend src/ (React 19 + xterm.js)              │
│   features/terminal — rendering, agent detection │
├─────────────────────────────────────────────────┤
│ IPC: #[tauri::command] + Channel<&[u8]>          │
│   src-tauri/src/handler — ~70 command entries    │
│   src-tauri/src/bridge  — service trait impls    │
├─────────────────────────────────────────────────┤
│ Rust workspace (src-tauri/crates/)               │
│   service — session lifecycle, reader threads    │
│   infra   — PTY, git, log files, DB init         │
│   repo    — Diesel CRUD                          │
│   model   — DTOs, schema, error types            │
├─────────────────────────────────────────────────┤
│ Storage: app.db (SQLite, WAL) + pty_logs/*.log   │
└─────────────────────────────────────────────────┘
```

Three design decisions worth expanding:

**The service crate doesn't know Tauri exists.** [service](https://github.com/AkaraChen/2code/tree/dev/src-tauri/crates/service) defines two traits, `PtyEventEmitter` and `WatchEventSender`, which the app layer implements in `bridge.rs`. Business logic runs under plain `cargo test`, and "which layer may touch what" is enforced at compile time.

**The DB stores metadata only.** Four tables — projects, project_groups, profiles, pty_sessions — and not a single byte of terminal output. There's a war story about why, further down.

**The frontend never hand-writes IPC clients.** After adding a Rust command you run `cargo tauri-typegen generate` and `src/generated/` updates itself. Hand-written clients are banned in the README because they inevitably drift from the Rust signatures.

## Why Tauri instead of Electron

To be clear: this isn't a benchmark shootout. It's the reasoning I used at the time, and three points still hold up.

**One: the heavy part of this app is the backend.** PTY management, git subprocesses, file watching, shell-injection scripts — the Rust side of 2code isn't "an API for the frontend", it's a real systems program. Rust is the natural home for that layer: [portable-pty](https://crates.io/crates/portable-pty) for pseudo-terminals, [notify](https://crates.io/crates/notify) for file watching, and no async runtime at all — tokio only shows up with its `sync` feature for channels, and the reader threads are plain `std::thread`. With Electron, that layer would be Node, and you'd be back to fighting node-pty's native module builds and distribution. Choosing Tauri meant putting the hardest layer in the language best suited to it.

**Two: no bundled Chromium.** Using the system webview makes the installer and the resident memory an order of magnitude smaller. The cost is a "webview variance tax": three platforms, three rendering engines, subtly different behavior. We've paid that tax — details in the war stories below.

**Three: the permission model.** Tauri 2 [capabilities](https://github.com/AkaraChen/2code/blob/dev/src-tauri/capabilities/default.json) let us narrow permissions down to "may execute `open` / `explorer` / `xdg-open`, with argument validation". For an app whose day job is spawning processes on your behalf, encoding the attack surface in a config file is a real security win.

One more nicety at the IPC layer: terminal output rides on Tauri's `Channel`, one independent byte stream per session — no hand-rolled multiplexing over the event bus.

## Hard problem 1: getting shells to behave in a PTY

Spawning a PTY is easy — portable-pty does it in a dozen lines. The hard part is shell integration: we want events like "a command started here, ended there, exited with this code, cwd is now this", because the title bar and status detection depend on them.

So we stand on VS Code's shoulders. Its [shell integration](https://code.visualstudio.com/docs/terminal/shell-integration) scripts are MIT-licensed; we embed them in the binary ([shell_init.rs](https://github.com/AkaraChen/2code/blob/dev/src-tauri/crates/infra/src/shell_init.rs)) and inject per shell: `--init-file` for bash, a swapped `ZDOTDIR` for zsh, `--init-command` for fish, `-NoExit -Command` for PowerShell. Then we set `TERM_PROGRAM=vscode` so the scripts believe they live inside a VS Code terminal and work as designed. 2code's own init scripts stay minimal on purpose — no agent wrappers, no PATH edits.

## Hard problem 2: the output pipeline, and why it left SQLite

This is my favorite war story.

In the first version, terminal output went into SQLite. Then [a migration dated 2026-07-01](https://github.com/AkaraChen/2code/tree/dev/src-tauri/migrations) dropped the whole `pty_session_output` table, and output moved to files: `pty_logs/{session_id}.log`.

The reason is physical. The DB is a single global connection (`Arc<Mutex<SqliteConnection>>`), and one chatty session — say, a scrolling `cargo build` — queues up write transactions until every other session's metadata writes are stuck behind the lock. Terminal write volume and relational-database write volume are different species; force them together and the mutex becomes the single point of failure.

The pipeline today: one reader thread per session pulls 4 KB chunks and splits them two ways. One way goes straight to the frontend over `Channel<&[u8]>` for rendering; the other crosses a channel to a dedicated persistence thread that flushes to disk every 32 KB or 250 ms. Rendering and disk never block each other, and the DB only shows up when a session is created, renamed, or closed.

## Hard problem 3: switching tabs must not kill the session

Once an xterm.js instance unmounts, its canvas state is gone; what mounts again is a brand-new terminal — scrollback and any running TUI program destroyed. So 2code has an iron rule written in the [terminal module's AGENTS.md](https://github.com/AkaraChen/2code/blob/dev/src/features/terminal/AGENTS.md): **Never unmount terminals**. It lands as three layers of defense:

1. **TerminalLayer**: every lane's terminals render inside a persistent overlay; inactive lanes get `display: none`.
2. **TerminalTabs**: tabs within a lane are stacked with absolute positioning; inactive ones get `visibility: hidden`.
3. **Parking**: when React 19's ref-cleanup ordering really does unmount a component whose tab is still open, the xterm DOM node is moved into an off-screen `#terminal-parking` container (`left/top: -9999px`) instead of being disposed. The trick is borrowed from VS Code's `setVisible(false)`.

A supporting detail: every mount generates a fresh `stream_id`, so cleanup left over from the previous mount can't kill the new stream.

What about restarting the app? The sessions really are dead then. Restore comes in a hot path and a cold path. Hot, on the Rust side: replay the log file through a [vt100](https://crates.io/crates/vt100) emulator — 10,000 lines of scrollback, alternate screen stripped so vim's ghost doesn't smear into history — spawn a fresh PTY, replay the "scene" onto the screen, and swap in a new session row. Cold, on the frontend: each session caches 1,000 serialized lines in localStorage, so a "looks-right" terminal appears instantly, then gets byte-level overlap de-duplication against the hot history.

## Worktree lanes: Git and UI each own half

A lane (profile) has its lifecycle orchestrated by the service crate: `git worktree add -b` creates the working copy, a `profiles` row lands, and the `setup_script` from your `2code.json` (say, `bun i`) runs inside the worktree. Paths follow a small convention: `~/.2code/workspace/{project}-{branch}-{8-char id}`, with CJK branch names transliterated to pinyin first. If you can't be bothered naming a branch, you get `pr/{city}-{8 hex}` — tokyo, osaka, seoul, and friends on rotation.

Deletion runs the sequence backwards: `teardown_script` → `git worktree remove --force` → `git branch -D` → DB foreign keys cascade the session rows away. Create and delete are both whole-operation affairs; no half-finished state left behind.

`init_script` takes a different route: it doesn't belong to the worktree flow but gets spliced into every new terminal's shell injection, so the env vars and aliases you put there apply to all of the lane's terminals.

On the UI side, the state collaboration is mostly agent detection: a rule engine living entirely in the frontend, with 18 agent rule manifests under [detector/rules](https://github.com/AkaraChen/2code/tree/dev/src/features/terminal/detector/rules) — Claude Code, Codex, Gemini, Kimi, and more. Three inputs: xterm screen text, OSC window titles, and OSC 9;4 progress sequences, evaluated every 250 ms, translating working / blocked / idle into the green dot and the sound on your tabs. We covered the product logic in [How Do You Know Your Agent Is Done?](/blog/how-do-you-know-your-agent-is-done) and the daily lane workflow in [Worktrees as Agent Workstations](/blog/worktree-as-agent-workstations); here it's just about where the code lives.

## War stories and the experimental bits

The README's first screen says macOS is the primary platform and Windows/Linux are experimental. That's not politeness:

- **macOS WebKit has a font-metrics trap.** When the canvas xterm uses to measure character widths isn't attached to the DOM, WebKit returns wrong metrics and the cursor drifts. The fix patches its measurement surfaces ([xtermMetricsPatch.ts](https://github.com/AkaraChen/2code/blob/dev/src/features/terminal/lib/xtermMetricsPatch.ts)). That's the webview variance tax — Electron users don't pay it, but you only pay it once.
- **Windows has opinions.** No native window decorations, so the title bar is frontend-drawn; subprocesses go through `command_without_windows_console` or every command flashes a console window; startup commands need a one-second sleep, a `\x1b[1;1R`, and `\r` line endings. ConPTY homework — everyone building terminals has to do it.
- **Linux odds and ends.** Sound goes through canberra / paplay, font enumeration through fontdb. The only cross-platform gate in CI is an Ubuntu 24.04 + xvfb smoke test — which at least guarantees Linux boots the app and opens a terminal.

## Run it locally

```bash
git clone https://github.com/AkaraChen/2code.git
cd 2code
bun install
bun tauri dev      # full desktop app with hot reload on both ends
```

Other usual suspects: `bun run dev` for the frontend only; `cd src-tauri && cargo test` for the Rust tests; `just verify` to run lint, typecheck, and all tests in one go. After changing a Rust command, remember `cargo tauri-typegen generate` to regenerate the frontend bindings.

## Where to contribute

There's no CONTRIBUTING.md yet, but a few things serve better:

- **[The AGENTS.md series](https://github.com/AkaraChen/2code/blob/dev/AGENTS.md)**: one overview at the root, plus dedicated files for terminal, src-tauri, handler, and e2e. They're named for coding agents, but they're the best map of the codebase for humans too.
- **[openspec/specs](https://github.com/AkaraChen/2code/tree/dev/openspec/specs)**: 13 feature specs — PTY management, terminal tabs, lanes, and more. Read them before changing behavior.
- **[plans/](https://github.com/AkaraChen/2code/tree/dev/plans)**: 28 confirmed optimization plans from a performance audit, plus 5 rejected ones with benchmarks. If you want a good first issue, this is a ready-made list, and every plan ships its own measurements.
- **[detector/rules](https://github.com/AkaraChen/2code/tree/dev/src/features/terminal/detector/rules)**: your favorite agent missing from the 18? Adding one rule file is a complete contribution.

Windows and Linux polish is permanently welcome — the flip side of "experimental" is that there's a reachable problem everywhere.

## Wrapping up

2code is open source on GitHub: <https://github.com/AkaraChen/2code> — stars, issues, and PRs all welcome. Or just try it:

```bash
brew install --cask akarachen/tap/2code
```
