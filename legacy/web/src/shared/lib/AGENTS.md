# AGENTS.md — src/shared/lib

## OVERVIEW
Centralized infrastructure for TanStack Query, storage utilities, and locale helpers. All other features import from here.

## FILES
| File | Role |
|------|------|
| `queryKeys.ts` | **All** TanStack Query key factories — use these, never inline strings |
| `queryClient.ts` | Configured `QueryClient` instance (default stale times, retry policy) |
| `tauriStorage.ts` | Tauri `plugin-store` adapter — async key-value persistence |
| `cachedPromise.ts` | Single-flight promise dedup utility (prevents redundant IPC calls) |
| `locale.ts` | Paraglide locale initialization helper |

## KEY PATTERNS

**Query keys are centralized here** — every TanStack Query `queryKey` in the project must come from `queryKeys.ts`:
```ts
queryKeys.projects.all          // all projects
queryKeys.git.diff(contextId)   // git diff for a context
queryKeys.git.log(contextId)    // commit history
```
Mutation hooks invalidate via these keys — never use raw string arrays.

**`tauriStorage.ts`** wraps `@tauri-apps/plugin-store` to match the Zustand `persist` storage interface. Used by persisted stores (`terminalSettingsStore`, `themeStore`, `notificationStore`).

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add new query key namespace | `queryKeys.ts` |
| Modify cache/retry policy | `queryClient.ts` |
| Persistent Zustand stores | `tauriStorage.ts` (storage adapter) |
