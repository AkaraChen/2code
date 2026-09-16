# AGENTS.md — src-tauri/crates/infra

## OVERVIEW
Cross-cutting infrastructure. All I/O, OS interaction, and external process management lives here.

## FILES
| File | Role |
|------|------|
| `archive.rs` | Archive preview entry listing for zip/tar/gzip files |
| `db.rs` | SQLite init + WAL pragma + `embed_migrations!()` auto-run on startup |
| `filesystem.rs` | File-tree operations, worktree path validation, fuzzy file resolution |
| `git.rs` | Git command execution via `std::process::Command` |
| `office.rs` | File preview helpers and LibreOffice office→PDF conversion |
| `config.rs` | Load `2code.json` from project root + execute `setup_script`/`teardown_script` via `sh -c` |
| `logger.rs` | Debug log capture + `start_debug_log`/`stop_debug_log` implementation |
| `slug.rs` | CJK-aware slug generation using `pinyin` crate — for profile worktree directory/branch names |
| `watcher.rs` | `notify` crate file system watcher → emits `watch-event` Tauri events |

## KEY NOTES
- **`slug.rs`** is well-tested; handles CJK → pinyin romanization (don't simplify)
- **`db.rs`** uses WAL journal mode + `foreign_keys=ON` — don't change pragmas without testing

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Git command details | `git.rs` |
