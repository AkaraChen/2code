# AGENTS.md — src/features/terminal

## OVERVIEW
PTY terminal management with xterm.js. The most complex frontend feature.

## FILES
| File | Role |
|------|------|
| `store.ts` | Zustand+Immer state: `profiles` (tabs per project), `agentStatuses` (session → running/waiting) |
| `state.ts` | Terminal state types and tab lifecycle logic |
| `Terminal.tsx` | xterm.js component (~305 lines) — connects PTY to xterm |
| `TerminalLayer.tsx` | Persistent overlay across all routes (CSS display:none) |
| `TerminalTabs.tsx` | Tab bar with agent status dots |
| `TerminalPreview.tsx` | Read-only terminal snapshot for non-active profiles |
| `hooks.ts` | `useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme` |
| `themes.ts` | xterm.js color theme definitions |

## KEY PATTERNS

**Never unmount terminals** — `TerminalLayer` renders all terminals always; CSS `display: none` hides inactive ones. Conditional rendering breaks xterm.js canvas state.

**xterm.js addon stack** (loaded in `Terminal.tsx`):
- `FitAddon` — resize to container
- `WebLinksAddon`, `ClipboardAddon`, `ImageAddon`, `LigaturesAddon`, `ProgressAddon`

**Session restoration flow**:
1. Fetch closed session history from DB
2. Pass old `session.id` as `restoreFrom` prop
3. Terminal writes scrollback chunks, then deletes old record

**Agent status system**: agent hooks call `$_2CODE_HELPER status running|waiting|idle` → backend emits `pty-agent-status` → `terminalStore.setAgentStatus(sessionId, status)` → blinking green for running, yellow for waiting. `notify` remains sound-only.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Tab state shape | `store.ts` — `profiles[profileId].tabs`, `activeTabId`, `counter` |
| xterm instance creation | `Terminal.tsx` lines ~145–297 (ref callback) |
| PTY output streaming | `Channel<ArrayBuffer>` + `attach_pty_output` in `Terminal.tsx`; backend send in `bridge.rs` / `service::pty::read_pty_output` |
| Scrollback restore | `Terminal.tsx` + `src-tauri/crates/service/src/pty.rs` |
| Shell env vars for helper | `infra/shell_init.rs` (`_2CODE_HELPER_URL`, `_2CODE_SESSION_ID`) |

## ANTI-PATTERNS
- Conditional rendering of `<Terminal>` — breaks xterm state (use CSS only)
- `useTerminalStore(…)` in mutations — use `useTerminalStore.getState()` instead
- Reintroducing per-chunk UTF-8 decoding on the live output path — output now streams as raw bytes to xterm.js, which decodes UTF-8 across writes; decoding chunks yourself re-breaks multibyte characters at chunk boundaries
