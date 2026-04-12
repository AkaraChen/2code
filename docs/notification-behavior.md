# Notification Behavior

This document defines the terminal notification state machine for unread green dots in the sidebar and tab strip.

## State Model

- Notification events are reported per `sessionId` from the PTY helper pipeline.
- Unread state is stored per terminal tab in `terminalStore.notifiedTabs`.
- Sidebar profile dots are derived from tab unread state. Profiles do not store a separate unread flag.
- The currently focused tab is the active tab for the profile in the current route:
  - route shape: `/projects/:projectId/profiles/:profileId`
  - active tab: `terminalStore.profiles[profileId].activeTabId`

## Render Rules

- A tab shows a green dot when its `sessionId` is in `notifiedTabs` and it is not the profile's active tab.
- A profile shows a green dot when any of its tabs has unread state.
- The focused tab must never keep unread state. If a notification is reported for the focused tab, the store drops it immediately.
- Default profiles follow the same sidebar-dot and read-clearing rules as non-default profiles.

## Behavior Table

| Event | Preconditions | State Transition | Result |
| --- | --- | --- | --- |
| PTY reports `notify(sessionId)` for focused tab | `sessionId` belongs to current route profile and equals its `activeTabId` | Remove `sessionId` from `notifiedTabs` | No green dot on tab or sidebar |
| PTY reports `notify(sessionId)` for background tab in current profile | `sessionId` belongs to current route profile and is not the `activeTabId` | Add `sessionId` to `notifiedTabs` | Green dot on that tab and on the profile sidebar item |
| PTY reports `notify(sessionId)` for tab in another profile | `sessionId` belongs to a non-focused profile | Add `sessionId` to `notifiedTabs` | Green dot on that tab and on that profile sidebar item |
| PTY reports `notify(sessionId)` before the tab is mounted in the frontend | `sessionId` is not in `profiles[*].tabs` yet | Add `sessionId` to `notifiedTabs` | Notification survives startup races and appears once the tab is added |
| User clicks a tab title | Target tab exists in the current profile | Set `activeTabId = tabId`, remove `tabId` from `notifiedTabs` | Only that tab is marked read |
| User clicks a sidebar profile item | Profile exists in the sidebar | Remove all tabs in that profile from `notifiedTabs` | Entire profile is marked read |
| Focused profile opens a new tab | `addTab(profileId, sessionId)` and route profile is `profileId` | Create tab, set it active, remove new active tab from `notifiedTabs` | New focused tab never starts with a green dot |
| Focused profile closes the active tab | Active tab is removed and another tab becomes active | Remove closed tab from `notifiedTabs`, promote next tab, remove promoted active tab from `notifiedTabs` | Newly exposed focused tab does not inherit a green dot |
| Any tab is closed | Tab exists | Remove closed tab from `notifiedTabs` | Closed tabs leave no unread residue |
| Profile is removed or pruned as stale | Profile exists in store | Remove all of its tab ids from `notifiedTabs` | No orphan unread state remains |

## Intent

- Sidebar click and tab click intentionally do different things:
  - sidebar click marks the whole profile as read
  - tab click marks only the selected tab as read
- Focus wins over unread. If the user is already looking at a tab, we do not keep or resurrect a green dot for it later.

## Relevant Code

- Frontend state: `src/features/terminal/store.ts`
- Tab dots: `src/features/terminal/TerminalTabs.tsx`
- Sidebar dots:
  - `src/layout/sidebar/ProfileItem.tsx`
  - `src/layout/sidebar/ProjectMenuItem.tsx`
- Backend event source:
  - `src-tauri/src/helper.rs`
  - `src-tauri/bins/2code-helper/src/main.rs`
