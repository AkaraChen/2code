# AGENTS.md — src/features/terminal

## OVERVIEW
PTY terminal management with `@wterm/react`. The most complex frontend feature.

## FILES
| File | Role |
|------|------|
| `store.ts` | Zustand+Immer state: `profiles` (tabs per project), `notifiedTabs` (Set) |
| `state.ts` | Terminal state types and tab lifecycle logic |
| `Terminal.tsx` | `@wterm/react` component — connects PTY to wterm |
| `TerminalLayer.tsx` | Persistent overlay across all routes (CSS display:none) |
| `TerminalTabs.tsx` | Tab bar with notification dots |
| `TerminalPreview.tsx` | Read-only terminal snapshot for non-active profiles |
| `hooks.ts` | `useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme` |
| `themes.ts` | Terminal color theme definitions |

## KEY PATTERNS

**Never unmount terminals** — `TerminalLayer` renders all terminals always; CSS `display: none` hides inactive ones. Conditional rendering breaks terminal state restoration and layout sync.

**wterm integration** (implemented in `Terminal.tsx`):
- `autoResize` handles container size changes
- Terminal-specific shortcuts are intercepted in React and forwarded to the PTY
- Theme/font changes are applied via CSS custom properties and a manual layout sync pass
- URL activation is detected from DOM rows and routed through the existing confirm dialog

**Session restoration flow**:
1. Fetch closed session history from DB
2. Pass old `session.id` as `restoreFrom` prop
3. Terminal writes scrollback chunks, then deletes old record

**Notification system**: PTY shells call `$_2CODE_HELPER notify` → backend emits `pty-notify` → `terminalStore.markNotified(sessionId)` → green dot on tab. Cleared on tab focus via `markRead`.

**Immer MapSet**: `notifiedTabs` is `Set<string>` — requires `enableMapSet()` (called at module level in `store.ts`). If adding `Set`/`Map` to other stores, enable it there too.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Tab state shape | `store.ts` — `profiles[profileId].tabs`, `activeTabId`, `counter` |
| wterm instance wiring | `Terminal.tsx` |
| PTY output streaming | `src-tauri/crates/infra/src/pty.rs` |
| Scrollback restore | `Terminal.tsx` + `src-tauri/crates/service/src/pty.rs` |
| Shell env vars for helper | `infra/shell_init.rs` (`_2CODE_HELPER_URL`, `_2CODE_SESSION_ID`) |

## ANTI-PATTERNS
- Conditional rendering of `<Terminal>` — breaks persistent terminal state (use CSS only)
- `useTerminalStore(…)` in mutations — use `useTerminalStore.getState()` instead
- Removing `find_utf8_boundary` call in PTY output — breaks multibyte characters
