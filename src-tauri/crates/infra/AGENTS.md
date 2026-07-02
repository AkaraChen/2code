# AGENTS.md — src-tauri/crates/infra

## OVERVIEW
Cross-cutting infrastructure. All I/O, OS interaction, and external process management lives here.

## FILES
| File | Role |
|------|------|
| `db.rs` | SQLite init + WAL pragma + `embed_migrations!()` auto-run on startup |
| `pty.rs` | PTY session lifecycle: spawn shell, 4KB read loop (live output delivery + persistence live in `service::pty`) |
| `pty_log.rs` | Per-session output storage as `{app_data_dir}/pty_logs/{session_id}.log` files (append/read/clear/remove + startup orphan GC). No byte cap. |
| `git.rs` | Git command execution via `std::process::Command` |
| `shell_init.rs` | ZDOTDIR-based shell init injection for VS Code shell integration and project init scripts |
| `config.rs` | Load `2code.json` from project root + execute `setup_script`/`teardown_script` via `sh -c` |
| `logger.rs` | Debug log capture + `start_debug_log`/`stop_debug_log` implementation |
| `slug.rs` | CJK-aware slug generation using `pinyin` crate — for profile worktree directory/branch names |
| `watcher.rs` | `notify` crate file system watcher → emits `watch-event` Tauri events |

## KEY NOTES
- **PTY live output** sends PTY bytes as `&[u8]` over a per-session IPC `Channel` (frontend receives `ArrayBuffer`; see `service::pty::read_pty_output` + app-layer `bridge.rs`); xterm.js decodes UTF-8 across writes, so no boundary splitting happens on the output path. (`find_utf8_boundary` lives in `service::pty`, not here, and is now unused on the live path.)
- **`slug.rs`** is well-tested; handles CJK → pinyin romanization (don't simplify)
- **`db.rs`** uses WAL journal mode + `foreign_keys=ON` — don't change pragmas without testing

## WHERE TO LOOK
| Task | Location |
|------|----------|
| PTY output read/flush sizes | `pty.rs` — 4KB read; `service::pty` — 32KB flush buffer |
| PTY output file storage | `pty_log.rs` — one append-only file per session, no cap |
| Shell init injection | `shell_init.rs` |
| Git command details | `git.rs` |
