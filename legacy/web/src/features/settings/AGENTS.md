# AGENTS.md — src/features/settings

## OVERVIEW
App settings page with three persisted Zustand stores (terminal, theme, notifications) and UI picker components.

## FILES
| File | Role |
|------|------|
| `SettingsPage.tsx` | Settings route component |
| `FontPicker.tsx` | System font selector (macOS via `core-text`, Linux/Windows via `fontdb`) |
| `FontSizePicker.tsx` | Font size stepper |
| `TerminalThemePicker.tsx` | Terminal color scheme selector |
| `SoundPicker.tsx` | Notification sound selector (macOS/Linux/Windows platform sources) |
| `BorderRadiusPicker.tsx` | UI corner radius setting |
| `NotificationSettings.tsx` | PTY notification on/off toggles |
| `stores/terminalSettingsStore.ts` | Font family, font size, terminal theme — localStorage persist |
| `stores/terminalSettingsStore.test.ts` | Store tests |
| `stores/themeStore.ts` | Light/dark/system mode — localStorage persist |
| `stores/themeStore.test.ts` | Store tests |
| `stores/notificationStore.ts` | Per-profile notification enabled flags — localStorage persist |
| `stores/notificationStore.test.ts` | Store tests |

## KEY PATTERNS

**All three stores use `persist` middleware** (localStorage). Shape must be versioned if you add fields — use Zustand's `version` + `migrate` options to avoid stale localStorage breaking the app.

**Platform-backed APIs**: `FontPicker` calls `listSystemFonts`, `SoundPicker` calls `listSystemSounds` — both are Tauri commands with macOS, Linux, and Windows backend arms. Keep empty-list UI graceful because platform sound/font sources can still be unavailable.

**Stores are independent**: `terminalSettingsStore` feeds `Terminal.tsx` directly; `themeStore` feeds `ThemeProvider`; `notificationStore` feeds the notification dot logic.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Read font/size in terminal | `stores/terminalSettingsStore.ts` |
| Theme provider integration | `src/shared/providers/ThemeProvider.tsx` |
| Sound playback backend | `src-tauri/src/handler/sound.rs` |
