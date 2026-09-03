# AGENTS.md — src/features/debug

## OVERVIEW
Debug panel system: floating overlay (Cmd+Shift+D) + log viewer dialog, backed by two persisted Zustand stores.

## FILES
| File | Role |
|------|------|
| `DebugFloat.tsx` | Floating debug panel — toggled via Cmd+Shift+D |
| `DebugLogDialog.tsx` | Full debug log viewer dialog |
| `debugStore.ts` | Zustand store: debug panel visibility + settings |
| `debugStore.test.ts` | Store tests |
| `debugLogStore.ts` | Zustand store: captured log entries from Tauri `start_debug_log` |
| `debugLogStore.test.ts` | Store tests |

## KEY PATTERNS

**Two-store pattern**: `debugStore` handles UI state (open/closed, config); `debugLogStore` accumulates log entries from the backend Tauri channel (`start_debug_log` / `stop_debug_log` commands in `handler/debug.rs`).

**Backend integration**: Logs come via `LogEntry` events from `src-tauri/crates/infra/src/logger.rs`. The frontend subscribes to a Tauri event channel and appends to `debugLogStore`.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Debug log backend | `src-tauri/crates/infra/src/logger.rs` |
| Tauri commands | `src-tauri/src/handler/debug.rs` |
| Log entry type | `src-tauri/crates/model/src/debug.rs` (`LogEntry`) |
