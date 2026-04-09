# AGENTS.md — src/features/topbar

## OVERVIEW
Customizable project top bar with a draggable control registry. Users add/remove/reorder controls.

## FILES
| File | Role |
|------|------|
| `registry.ts` | Control registry — maps control IDs to React components |
| `types.ts` | `TopBarControl`, `TopBarConfig`, `ControlId` types |
| `controls.tsx` | Built-in control components (branch display, git diff trigger, etc.) |
| `store.ts` | Zustand store: `enabledControls: ControlId[]`, layout persistence |
| `store.test.ts` | Unit tests for store logic |
| `DraggableControl.tsx` | Drag-and-drop wrapper for reordering controls |
| `AvailableControls.tsx` | Settings panel listing all registered controls |
| `TopBarSettings.tsx` | Settings dialog for configuring the top bar |
| `TopBarPreview.tsx` | Live preview of the configured top bar |

## KEY PATTERNS

**Registry pattern**: Controls are registered in `registry.ts` as a map. Adding a new control = add entry to registry + create component in `controls.tsx`. The store only stores `ControlId[]` (serializable), not component refs.

**Separate from `git` feature**: Despite showing branch/diff info, `topbar` is independent — it _uses_ git hooks from `features/git/` but has its own store and settings.

## WHERE TO LOOK
| Task | Location |
|------|----------|
| Add a new control | `registry.ts` (register) + `controls.tsx` (implement) |
| Persisted layout | `store.ts` — uses Zustand `persist` middleware |
| TopBar rendering entry | `ProjectTopBar.tsx` in `features/git/` renders this feature's controls |

## ANTI-PATTERNS
- Storing component references in Zustand — store `ControlId[]` only
