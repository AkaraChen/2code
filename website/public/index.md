# 2code

> Your agents need a better terminal.

**2code** is a terminal workstation for projects, Git worktrees, and AI coding agents.

Normal terminals run commands. 2code also manages projects, worktrees, and agents — with persistent sessions, finish notifications, file editing, and git review in one desktop app.

- **Website:** https://2code.akr.moe/
- **中文:** https://2code.akr.moe/zh-cn
- **GitHub:** https://github.com/AkaraChen/2code
- **Releases:** https://github.com/AkaraChen/2code/releases/latest
- **AI brief:** https://2code.akr.moe/llms.txt · https://2code.akr.moe/llms-full.txt

## Install (macOS)

```bash
brew install --cask akarachen/tap/2code
```

macOS is the primary platform. Windows and Linux support is experimental.

## Features

### Persistent terminals

Return to the terminal you left behind. 2code keeps sessions, layouts, and history around after restarts so you get back to the same working state.

- Restore terminal history and workspace layout after restart
- Keep long-running sessions tied to the project they belong to
- Return to work without reopening every command by hand

### Built-in file editing and git review

Edit files and review changes in place. A file tree and lightweight editor handle quick changes; the git client keeps diffs and commit history close to the terminal workflow.

### Worktree windows

Keep each task in its own lane. Open each project or worktree in its own window with its own terminals and context so switching between tasks stays clear.

### Agent awareness

Monitor CLI coding agents more easily: 2code can show a green indicator and play a sound when an agent finishes, so you do not have to stare at every pane.

### Command templates and session restore

Templates open recurring CLI apps and project commands quickly. After restart, projects, worktrees, windows, terminals, and history come back close to where you left them.

## Who it is for

Developers who live in terminals, work across multiple projects or worktrees, and want agent runs, dev servers, git review, and quick edits in one place.

## What it is not

2code is a real terminal emulator and workstation — not a hosted coding model, not an API proxy for LLMs, and not a full traditional IDE replacement.

## Related products

Useful context when comparing agentic coding tools:

- [Superset](https://superset.sh) — run many parallel coding agents with worktree isolation
- [Orca](https://tryorca.com) — git, terminal, and AI coding in one app
- JetBrains IDEs + AI assistants — full IDE-centered workflows

## Citation blurb

2code is an open-source desktop terminal workstation for AI-assisted development (https://2code.akr.moe). It combines persistent terminals, project/worktree windows, agent-finish notifications, lightweight editing, and git review. Primary platform: macOS. Source: https://github.com/AkaraChen/2code.
