# AGENTS.md — src-tauri/crates/infra

## OVERVIEW
Cross-cutting infrastructure. All I/O, OS interaction, and external process management lives here.

## FILES
| File | Role |
|------|------|
| `db.rs` | SQLite init + WAL pragma + `embed_migrations!()` auto-run on startup |
| `pty.rs` | PTY session lifecycle: spawn shell, 4KB read loop, UTF-8 boundary detection, 1MB cap with oldest-chunk pruning |
| `git.rs` | Git command execution via `std::process::Command` |
| `shell_init.rs` | ZDOTDIR-based shell init injection — sets `_2CODE_HELPER`, `_2CODE_HELPER_URL`, `_2CODE_SESSION_ID` env vars |
| `helper.rs` | Axum HTTP server (sidecar endpoint) — receives `/notify?session_id=` → plays sound + emits `pty-notify` event |
| `config.rs` | Load `2code.json` from project root + execute `setup_script`/`teardown_script` via `sh -c` |
| `logger.rs` | Debug log capture + `start_debug_log`/`stop_debug_log` implementation |
| `slug.rs` | CJK-aware slug generation using `pinyin` crate — for profile worktree directory/branch names |
| `watcher.rs` | `notify` crate file system watcher → emits `watch-event` Tauri events |

## KEY NOTES
- **`find_utf8_boundary`** in `pty.rs` — DO NOT remove; prevents splitting multibyte chars when flushing 4KB chunks
- **`helper.rs`** runs an Axum server in a background thread; port stored in env var passed to PTY shells
- **`slug.rs`** is well-tested; handles CJK → pinyin romanization (don't simplify)
- **`db.rs`** uses WAL journal mode + `foreign_keys=ON` — don't change pragmas without testing

## WHERE TO LOOK
| Task | Location |
|------|----------|
| PTY output chunk size | `pty.rs` — 4KB read, 32KB flush buffer, 1MB cap |
| Shell env injection | `shell_init.rs` |
| Git command details | `git.rs` |
| Notification flow | `helper.rs` → service layer |
