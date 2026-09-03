# AGENTS.md — src/features/terminal

## OVERVIEW
PTY terminal management with xterm.js. The most complex frontend feature.

## FILES
| File | Role |
|------|------|
| `store.ts` | Zustand+Immer state: `profiles` (tabs per project), `agentStatuses` (session → running/waiting) |
| `state.ts` | Terminal state types and tab lifecycle logic |
| `Terminal.tsx` | xterm.js component (~305 lines) — connects PTY to xterm |
| `detector/` | Agent status detector; one manifest file per agent under `detector/rules/` |
| `TerminalLayer.tsx` | Persistent overlay across all routes (CSS display:none) |
| `TerminalTabs.tsx` | Tab bar with agent status dots |
| `TerminalPreview.tsx` | Read-only terminal snapshot for non-active profiles |
| `hooks.ts` | `useCreateTerminalTab`, `useCloseTerminalTab`, `useRestoreTerminals`, `useTerminalTheme` |
| `themes.ts` | xterm.js color theme definitions |
| `lib/attachedCanvas.ts` | Hidden in-document host for measuring canvases (WebKit font resolution) |
| `lib/xtermMetricsPatch.ts` | Redirects xterm's two font-measurement surfaces to attached canvases |
| `lib/charSize.ts` | Cell-width truth check + forced re-measure; self-heals a stale fit |

## KEY PATTERNS

**Never unmount terminals** — `TerminalLayer` renders all terminals always; CSS `display: none` hides inactive ones. Conditional rendering breaks xterm.js canvas state.

**xterm.js addon stack** (loaded in `Terminal.tsx`):
- `FitAddon` — resize to container
- `WebLinksAddon`, `ClipboardAddon`, `ImageAddon`, `LigaturesAddon`, `ProgressAddon`

**Session restoration flow**:
1. Fetch closed session history from DB
2. Pass old `session.id` as `restoreFrom` prop
3. Terminal writes scrollback chunks, then deletes old record

**Font measurement must use an attached canvas** — WebKit only resolves locally installed fonts for canvases that are in the document. A detached `document.createElement("canvas")` and every `OffscreenCanvas` measure against a fallback-only font environment. Measured in macOS WKWebView, SarasaNZSSlab NFM at 14px: detached/offscreen `8.401px` (0.6 em fallback) vs attached/DOM `7.000px` (the real 0.5 em font).

xterm 6 measures through canvas but paints through the DOM, and both of its measurement surfaces are offscreen — `CharSizeService`'s `TextMetricsMeasureStrategy` and `WidthCache`'s four canvases. Left alone it reserves 8.4px cells for glyphs it draws 7.0px wide, so `FitAddon` picks too few columns and ~1/6 of the viewport stays empty. `lib/xtermMetricsPatch.ts` swaps both surfaces for attached canvases at `open()`; the measurement *logic* is unchanged, only the surface. `lib/attachedCanvas.ts` owns the hidden host (`visibility: hidden`, never `display: none` — that would remove it from layout and defeat the fix).

**Agent status system**: `Terminal.tsx` reads xterm screen text, OSC title, and OSC progress after live output writes. `detector/` matches per-agent manifests and publishes `running|waiting|idle` to `terminalStore.setAgentStatus(sessionId, status)`. Waiting status can play the configured system sound via `playSystemSound`.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Tab state shape | `store.ts` — `profiles[profileId].tabs`, `activeTabId`, `counter` |
| xterm instance creation | `Terminal.tsx` lines ~145–297 (ref callback) |
| PTY output streaming | `attach_pty_output(sessionId, streamId)` registers the active sink, then `stream_pty_output` owns `Channel<ArrayBuffer>` in `Terminal.tsx`; `detach_pty_output` must use the same `streamId` so stale cleanup cannot remove a newer stream |
| Scrollback restore | `Terminal.tsx` + `src-tauri/crates/service/src/pty.rs` |
| Agent rules | `detector/rules/*.ts` — keep one agent per manifest file |
| Terminal not filling its width | `lib/xtermMetricsPatch.ts` — compare xterm's `dimensions.css.cell.width` against an attached-canvas `measureText("W")` |

## ANTI-PATTERNS
- Conditional rendering of `<Terminal>` — breaks xterm state (use CSS only)
- `useTerminalStore(…)` in mutations — use `useTerminalStore.getState()` instead
- Reintroducing per-chunk UTF-8 decoding on the live output path — output arrives as byte values and xterm.js decodes UTF-8 across writes; decoding chunks yourself re-breaks multibyte characters at chunk boundaries
- Measuring font metrics with a detached canvas or `OffscreenCanvas` — reports fallback metrics on WebKit; use `getSharedAttachedContext()` from `lib/attachedCanvas.ts`
- Patching only one of the two measurement surfaces — the DOM renderer derives its letter-spacing compensation from `cell.width - widthCache.get("W")`, so a one-sided fix renders text cramped or spread out instead of merely mis-sized
