# 2code UI Inventory — Settings, Terminal, Git, Debug, Updater & Dialogs

Framework-agnostic inventory derived from source code in `/workspace`. Intended for reimplementing the UI without the current frontend stack.

**Scope:** Settings window, Terminal UI, Git UI, Debug UI, Updater UI, and all remaining modal dialogs/overlays.

**Out of scope (referenced only where they attach):** Home page, sidebar, file tree, file viewer, command palette, notes editor, onboarding tour.

---

## Table of Contents

1. [Window Architecture](#1-window-architecture)
2. [Settings Window](#2-settings-window)
3. [Terminal UI](#3-terminal-ui)
4. [Git UI](#4-git-ui)
5. [Debug UI](#5-debug-ui)
6. [Updater UI](#6-updater-ui)
7. [Remaining Dialogs & Overlays](#7-remaining-dialogs--overlays)
8. [Global Toast System](#8-global-toast-system)
9. [Cross-Cutting Platform Differences](#9-cross-cutting-platform-differences)
10. [Keyboard Shortcuts Summary](#10-keyboard-shortcuts-summary)

---

## 1. Window Architecture

### 1.1 Main Window (`tauri.conf.json`)

| Property | Value |
|----------|-------|
| Title (internal) | `2code` |
| Visible title bar text | Hidden (`hiddenTitle: true`) |
| Decorations | Enabled |
| Title bar style | **Overlay** (macOS-style integrated title bar) |
| Traffic light position (macOS) | x=16, y=24 |
| Default size | 1440 × 900 px, centered |
| Maximizable | Yes |

**Layout (main window root):**

```
MainWindow
├── StartupUpdateCheck (invisible — side effect only)
├── Horizontal split
│   ├── AppSidebar (left, collapsible)
│   └── Main content area (relative, scrollable card background)
│       ├── Routes (Home / Project detail placeholder)
│       └── TerminalLayer (absolute inset-0 overlay; shown on profile routes)
├── DebugFloat (fixed bottom-right FAB, conditional)
└── WindowControls (Windows only — custom min/max/close)
```

**Drag region:** Project top bar uses `data-tauri-drag-region` for window dragging on macOS overlay chrome.

### 1.2 Settings Window (second webview)

Created by Tauri command `open_settings_window` when not already open.

| Property | Value |
|----------|-------|
| Label | `settings` |
| Title | `Settings` |
| URL | `index.html` (same SPA entry; frontend branches on window label) |
| Size | 880 × 640 px (default), min 600 × 420 px |
| Centered | Yes |
| Decorations | System default (no overlay title bar config) |

**Frontend branch (`main.tsx`):** If `getCurrentWebviewWindow().label === "settings"`, render `SettingsWindow` instead of `App`. Settings window does **not** mount: file watcher, terminal layer, sidebar, or startup profiling sync.

**Settings URL tabs:** Query param `?tab=<tabId>` selects settings tab. `open_update_page` opens/reuses settings window with `?tab=about`.

**Cross-window sync:** Settings edited in the settings window sync to the main window via broadcast store sync (`crossWindowSync.ts`).

### 1.3 Global Providers (both windows)

Outer → inner: QueryClient → ThemeProvider → TooltipProvider → BrowserRouter → content → **Toaster** (Sonner toast stack).

---

## 2. Settings Window

### 2.1 Root: `SettingsWindow`

```
SettingsWindow
└── div (full height, card background, foreground text)
    └── SettingsPage
```

No sidebar, no terminal layer, no file watcher.

### 2.2 `SettingsPage` — Tab Shell

**Layout:** Full-height column.

```
SettingsPage
├── Tabs (flex-1 column, min-height 0)
│   ├── TabsList (horizontal, margin 20px top, scroll-x if overflow)
│   │   └── 6 × TabsTrigger (icon + label each)
│   └── Scrollable content area (padding 20px, flex-1 overflow auto)
│       └── TabsContent (one visible at a time)
```

**Tabs (left → right):**

| Tab ID | Icon | English label (`en.json`) |
|--------|------|---------------------------|
| `general` | Gear | General |
| `terminal` | Terminal window | Terminal |
| `template` | Code | Terminal Templates |
| `notification` | Bell | Notification |
| `topbar` | Monitor | Top Bar |
| `about` | Info | About |

**Tab state:** Persisted in URL search param `tab`. Default tab when absent: `general`. Changing to `general` clears the param.

**Terminal tab split layout:** Two columns with 32px gap:
- **Left column:** max-width ~28rem (`max-w-md`), vertical stack gap 24px — pickers
- **Right column:** flex-1 — live `TerminalPreview`

---

### 2.3 General Tab

**Container:** Vertical stack, max-width ~28rem, gap 24px.

#### 2.3.1 Language

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Language` |
| Control | Native select (small) | Options: `English` (value `en`), `中文` (value `zh`) |

Changing value calls `setAppLocale`.

#### 2.3.2 Theme (app light/dark)

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Theme` |
| Control | Native select (small) | `System`, `Light`, `Dark` |

Stored in `ThemeContext` preference (separate from terminal theme).

#### 2.3.3 BorderRadiusPicker

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Border Radius` |
| Control | Toggle group (small, single-select) | `None`, `Small`, `Medium`, `Large`, `Extra Large` |

**Store default:** `sm` (Small).

**Effect:** Sets CSS custom properties `--radius`, `--radius-sm/md/lg/xl` on document root.

#### 2.3.4 WorktreeSettings

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Default Worktree Directory` |
| Description | Field description | `Used for new profiles when a project does not set worktree_dir. Relative paths are resolved from the project folder.` |
| Row | Horizontal flex | Text input (editable path) + Outline button with folder icon (`Choose Folder`) + Ghost icon button (X, clear) |

**Placeholder:** `Default: ~/.2code/workspace`

**Clear button:** Disabled when path empty. Aria-label: `Clear default worktree directory`.

**Choose Folder:** Opens native directory picker dialog (Tauri).

**Store default:** empty string.

#### 2.3.5 Debug Mode

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Debug Mode` |
| Description | `Show backend log events in a floating panel.` |
| Control | Switch (right-aligned horizontal field) |

**Store default:** `enabled: false`. Persisted. Toggling on starts backend debug log channel.

#### 2.3.6 Performance Profiling

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Performance Profiling` |
| Description | `Write frontend and backend performance traces until this is turned off or the app exits.` |
| Control | Switch |

**Store default:** `enabled: false`. Not persisted across restarts (in-memory Zustand only).

#### 2.3.7 SidebarAppearanceSettings

| Element | Type | Content |
|---------|------|---------|
| Label | Field label | `Show Project Avatars` |
| Description | `Display project avatars in the left sidebar.` |
| Control | Switch |

**Store default:** `showProjectAvatars: true`.

---

### 2.4 Terminal Tab

**Left column (top → bottom):**

#### TerminalThemePicker

**When "sync theme" checked:**
- One theme select labeled `Terminal Theme`
- Preview eye button (ghost icon-xs, right of label)

**When sync unchecked:**
- `Dark Mode Theme` select + preview button
- `Light Mode Theme` select + preview button

**Theme select options** (display names from `themes.ts`):

| ID | Display name |
|----|--------------|
| github-dark | GitHub Dark |
| github-light | GitHub Light |
| dracula | Dracula |
| ayu-dark | Ayu Dark |
| ayu-light | Ayu Light |
| solarized-dark | Solarized Dark |
| solarized-light | Solarized Light |
| one-dark | One Dark |
| one-light | One Light |

**Preview button:** Aria-label `Preview`. Sets parent preview theme override.

**Sync checkbox row:** Checkbox + label `Use same theme for both modes`

**Store defaults:**
- `darkTerminalTheme`: `github-dark`
- `lightTerminalTheme`: `github-light`
- `syncTerminalTheme`: `false`

#### ShellPicker (async — skeleton 70px while loading)

| Element | Content |
|---------|---------|
| Label | `Default Shell` |
| Select | List of detected shells; default shell marked `(default)`; last option `Custom` |
| Conditional input | Shown when Custom selected — monospace input, placeholder `e.g. /usr/bin/fish` |
| Description | `Used for newly opened terminal tabs.` |

Shell list from backend `listAvailableShells`.

#### FontPicker (async — skeleton 70px)

| Element | Content |
|---------|---------|
| Label | `Terminal Font` |
| Select | Mono fonts by default; each option shows font family name |
| Empty state | Select shows `Unavailable` + description `No system fonts were found on this machine.` |
| Checkbox below | `Show all fonts` (includes non-monospace when checked) |

**Store defaults:** `fontFamily: "JetBrains Mono"`, `showAllFonts: false`

**Platform:** `listSystemFonts` — macOS Core Text, Linux/Windows fontdb.

#### FontSizePicker

| Element | Content |
|---------|---------|
| Label | `Font Size` |
| Control | Number input |

**Constraints:** min 10, max 20. **Default:** 13.

**Right column: TerminalPreview**

Read-only faux terminal block:
- Background/foreground from selected or auto terminal theme
- Font family/size from terminal settings store
- Padding 12px 16px, 8px border radius, 0.5px border
- Fixed sample lines: `whoami`, `ls`, `echo "Hello, 2code!"` with green `$` prompts
- Blinking block cursor on last empty prompt line

Preview updates live when font/size/theme eye-preview changes.

---

### 2.5 Template Tab (Global Terminal Templates)

**Container:** max-width ~42rem (`max-w-2xl`).

```
GlobalTerminalTemplatesSettings
├── Header row
│   ├── Title: "Global Templates" (semibold)
│   ├── Description: "These templates are available in every project."
│   └── Button (outline, sm): "Add Template"
├── Empty state OR template list
└── TerminalTemplateDraftDialog (modal)
```

**Empty state:** Bordered rounded box, muted text: `No templates yet.`

**Template list item (each):**
- Bordered rounded row, horizontal flex
- Left: template name (truncate, medium weight) + command preview (monospace, muted, truncate)
- Right: Ghost icon buttons — Edit (pencil), Delete (trash, destructive color)
- Disabled while save pending

**Store default:** empty templates array (persisted via Tauri storage).

---

### 2.6 Notification Tab

**Container:** max-width ~28rem, gap 24px.

#### Enable toggle

| Label | `Enable Notifications` |
| Description | `Allow this app to send system notifications.` |
| Control | Switch |

On enable: requests OS notification permission; if denied, toggle reverts.

**Store default:** `enabled: false`

#### SoundPicker (async)

| Label | `Sound` |
| Preview button | Speaker icon, aria-label `Preview` — disabled if notifications off, no sound, or no sounds |
| Select | `None` + system sound names; disabled when notifications off or no sounds |
| Empty | Shows `No system sounds` + description |

**Store default:** `sound: "Ping"`

**Platform:** `listSystemSounds` / `playSystemSound` — macOS `/System/Library/Sounds`, Windows `C:\Windows\Media`, Linux XDG dirs.

---

### 2.7 Top Bar Tab (`TopBarSettings`)

**Container:** max-width ~42rem, gap 24px.

```
TopBarSettings
├── Hint text: "Drag controls to reorder or move between areas."
├── DndContext
│   ├── TopBarPreview ("Current Controls")
│   ├── AvailableControls ("Available Controls")
│   └── DragOverlay (floating copy while dragging)
├── Optional app selects (if apps detected)
│   ├── Editor Application → native select
│   └── Terminal Application → native select
└── Button (outline, sm): "Reset to Defaults"
```

**Loading:** `Detecting installed apps...`

**Error:** Shows error message text.

**TopBarPreview:** Mock bar showing "My Project" + branch icon "main" + draggable active controls area.

**AvailableControls:** Dashed border drop zone for inactive controls.

**Drag behavior:**
- Reorder within preview
- Drag from preview to available → remove from bar
- Drag from available to preview → add to bar

---

### 2.8 About Tab (`AboutSettings`)

**Container:** max-width ~42rem, vertical gap 32px.

#### App identity section

| Element | Content |
|---------|---------|
| App icon | 80×80 px, drop shadow, alt "2code" |
| Title | `2code` (2xl semibold) |
| Version badge | `Version {version}` — clickable copies to clipboard; skeleton while loading |
| Tagline | `The Vibe Coding Workstation — A desktop workspace where terminal, AI agents, and Git live together for uninterrupted flow state.` |

Non-Tauri (web dev): version shows `dev`.

#### External links row

Two outline small buttons:
- GitHub icon + `Repository` + external arrow → `https://github.com/AkaraChen/2code`
- Tag icon + `Releases` + external arrow → releases URL

#### Update section (bordered card)

**Header bar:** Title `Update` + optional badge:
- If update available: `Update {version} is available`
- If checked and up to date: `Already up to date` (outline muted badge)

**Body:**
- Switch: `Accept Beta Updates` / `Check prerelease builds from the beta channel.`
- Status text (one of):
  - Update available description with current/latest versions
  - Release date line: `Released {date}` (locale-formatted)
  - Not available / idle descriptions
  - Error text (destructive color) if update error
- Buttons:
  - `Check for Updates` (outline) — shows spinner while checking
  - `Install {version}` (primary) — shown when update available; spinner while downloading

**Updater settings default:** `acceptBetaUpdates: false`

#### Contributors

Heading `Contributors` + clickable card:
- Avatar 36px round
- Name `AkaraChen`
- Subtitle `Project maintainer and primary contributor.`
- Hover: external arrow icon

#### Footer

`© {currentYear} AkaraChen` (xs muted)

---

### 2.9 TerminalTemplateDraftDialog (shared modal)

Used from Global Templates settings (and project templates elsewhere).

| Property | Value |
|----------|-------|
| Max width | ~32rem (`sm:max-w-lg`) |
| Title icon | Terminal window |
| Title | `Add Template` or `Edit Template` |

**Fields:**
1. **Template Name** — text input, placeholder `e.g. Dev Server`
2. **Working Directory** — optional (`showCwd` prop); only in project context
3. **Commands** — textarea 8 rows, monospace, placeholder `One command per line…`; description `Runs after the terminal starts. One command per line.`

**Footer (space-between):**
- Left: `Cancel` (outline) + `Delete` (destructive, edit mode only, spinner if pending)
- Right: `Save` (disabled if name empty or pending)

---

## 3. Terminal UI

### 3.1 Layer Architecture

```
TerminalLayer (absolute inset-0, one visible profile at a time)
├── For each active profile ID:
│   └── div (absolute inset-0; display flex/none)
│       └── ProfileLayout
│           ├── CommandPalette
│           ├── ProjectTopBar (see Git section)
│           ├── ProfileSidebar (files/git/notes — out of scope)
│           └── TerminalTabs
└── TerminalFileLinkPickerDialog (global, one instance)
```

**Persistence rule:** Terminals never unmount. Inactive profiles/tabs use CSS `display: none` or `visibility: hidden`.

**Global shortcuts (TerminalLayer, active profile only):**
- **⌘T** (metaKey + t): Create new terminal tab in active profile
- **⌘W** (metaKey + w): Close active terminal tab

Note: These check `e.metaKey` only (macOS-oriented).

---

### 3.2 ProfileLayout → Terminal Area

Below top bar + optional sidebar:

```
TerminalTabs (full width/height column)
├── Tab bar row (border-bottom, horizontal scroll)
│   └── TabsList (line variant)
│       ├── Terminal tab triggers (one per session)
│       ├── File tab triggers (one per open file)
│       └── TerminalTemplateMenu ("+ New Terminal")
├── File viewer pane (flex-1, conditional — only when file tab active)
└── Terminal area (flex-1, relative)
    ├── Per-tab absolute layers (visibility hidden when inactive)
    └── emptyFallback when no tabs
```

When file tab active: terminal area `display: none` (but terminals stay mounted).

---

### 3.3 Tab Bar

**Tab trigger layout class:** max-width 14rem (`max-w-56`), flex-none, left-aligned content.

#### Terminal tab trigger (each)

Left → right:
1. **Icon** — 14×14 px:
   - Default: terminal window icon
   - Agent keyword match (case-insensitive in title): claude, codex, gemini, kimi, cline, openclaw, opencode, qoder → respective brand SVG
2. **Title** — truncated text (from PTY OSC title or default)
3. **AgentStatusDot** (optional) — see §3.8
4. **Close button** — 16×16 hit target, X icon, aria-label `Close {title}`

**Drop target:** Terminal tabs accept file-tree drag-drop of paths (writes formatted paths to PTY).

#### File tab trigger (each)

1. File type icon (14px)
2. Truncated filename
3. Dirty indicator — 8px filled circle (muted) if unsaved
4. Close button

Closing dirty file → `UnsavedFileCloseDialog`.

#### TerminalTemplateMenu (trailing)

Rendered as last item in tab list.

**Primary click / Enter / Space on trigger:** Creates default empty terminal (does not open dropdown).

**Hover-open dropdown** (120ms close delay, non-modal):
- Empty: message `No templates yet.` + hint `Add project templates in Project Settings, or global templates in Settings.`
- **Project Templates** group (if any) — name + optional cwd subtitle
- Separator (if both groups)
- **Global Templates** group (if any)

Selecting template creates terminal running template commands.

**Button label:** `New Terminal`

---

### 3.4 Terminal Component (xterm.js host)

**Outer shell:**
- Flex column, relative, 100% size
- Padding: 8px top, 0 right/bottom, 8px left
- Background: terminal theme background color
- Overflow hidden

**Inner:** Flex-1 min-size-0 div — xterm mounts here in a 100% wrapper div.

**Search overlay (when open):** `TerminalSearchBar` positioned absolute top-right inside shell.

#### xterm visual configuration

| Setting | Value |
|---------|-------|
| Cursor | Bar, width 4px, blinking |
| Cursor inactive | Outline style |
| Scrollback | 5000 lines |
| Scrollbar | Hidden |
| macOptionIsMeta | false |

#### TerminalSearchBar

Fixed overlay: top-right (12px inset), z-index 20.

| Element | Details |
|---------|---------|
| Search input | width ~14rem, height 28px, autofocus; placeholder `Search terminal` |
| Result count | `No results` or `{current}/{total}` |
| Previous button | Caret up, aria `Previous match` |
| Next button | Caret down, aria `Next match` |
| Close button | X, aria `Close search` |

**Match highlight colors:** gold/brown inactive, blue active (hardcoded hex).

**Keyboard in search:**
- Escape → close, refocus terminal
- Enter → next match (Shift+Enter → previous)
- Typing → incremental search

#### Link handling

- Web links and file links open confirmation unless Ctrl/Cmd+click bypass
- **TerminalLinkConfirmDialog** for external URLs
- Ambiguous file paths → **TerminalFileLinkPickerDialog**

#### Agent detection

Polls every 250ms (2s when tab hidden). Publishes `running` | `waiting` | `idle` to store. Waiting triggers notification sound + optional system notification.

#### Process exit

Appends gray line: `[Process exited]`

---

### 3.5 Terminal Keyboard Shortcuts (in-terminal focus)

| Shortcut | Platform | Action |
|----------|----------|--------|
| ⌘F | macOS | Open search |
| Ctrl+Shift+F | Windows/Linux | Open search |
| ⌘= / ⌘+ | macOS | Increase font size |
| ⌘- | macOS | Decrease font size |
| Ctrl+L | All | Clear screen (+ PTY clear) |
| Ctrl+C | Windows/Linux | Copy selection, or SIGINT if no selection |
| Ctrl+V | Windows/Linux | Paste clipboard to PTY |
| ⌘← / ⌘→ | macOS | Send Home / End |
| Alt+← / Alt+→ | All | Word left / word right |
| Shift+Enter | All | Send newline |

Selection auto-copies to clipboard with toast **"Text copied"** (hardcoded English, not i18n).

Font size changes persist to terminal settings store (clamped 10–20).

---

### 3.6 TerminalLinkConfirmDialog

| Title | `Open Link` (link icon) |
| Description | `Choose where to open this link. Hold Ctrl and click to open directly in the default browser next time.` |
| URL label | `Link` |
| URL value | Monospace, break-all |
| Cancel | `Cancel` |
| Primary split button | `Open in Default Browser` + dropdown caret |
| Dropdown | List installed browsers (`listInstalledBrowsers`); disabled if empty; aria `Open With` |

---

### 3.7 TerminalFileLinkPickerDialog

| Max width | ~36rem |
| Title | `Choose File` (file icon) |
| Description | `The exact file path was not found. Select one of the matching files to open.` |
| List | Scrollable max 50vh, bordered |

**Each candidate row (min-height 44px):**
- File icon 16px
- Name (truncate, medium) + relative path (monospace xs muted)
- FileText icon trailing
- Click → opens file in file viewer tab, closes dialog

---

### 3.8 AgentStatusDot

8px circle (`size-2`), rounded full:

| Status | Appearance |
|--------|------------|
| `running` | Emerald green + pulsing shadow animation |
| `waiting` | Yellow (`yellow-400`) |
| `completed` | Green (`green-500`) — shown as dismissible notification dot on tab when no active status |

Dismiss completion: click dot, aria-label `Dismiss completion notification`.

---

### 3.9 TerminalPreview (settings only)

Static HTML/CSS mock terminal — not a live PTY. See §2.4.

---

## 4. Git UI

### 4.1 ProjectTopBar

**Height:** min 44px. **Padding:** platform-dependent right padding (Windows: extra 118px for system buttons).

**Three zones (horizontal):**

```
┌─────────────────────────────────────────────────────────────┐
│ [Left controls]     [Center title - absolute centered]  [Right controls] │
└─────────────────────────────────────────────────────────────┘
```

#### Left zone

- **Expand sidebar** button (only when app sidebar collapsed) — ghost icon, tooltip `Expand sidebar`
- **SidebarModeSwitch** (when sidebar mode props provided) — toggles Files / Git / Notes sidebar

#### Center zone (pointer-events split)

- **Project name** — semibold truncate, clickable → reveals worktree path in Finder/file manager (tooltip shows full path)
- **Branch control** — git branch icon + branch name, clickable → opens SwitchBranchDialog
  - Default profile + active: live git branch from repo
  - Non-default profile: shows `profile.branch_name` static

#### Right zone

- Dynamic **top bar controls** from registry (GitHub Desktop, editor launcher, terminal launcher, PR status, etc.)
- **Project settings** gear button (secondary icon) — tooltip `Project Settings` → ProjectSettingsDialog

**Keyboard shortcuts (active profile):**
- **⌘G / Ctrl+G:** Open Git diff dialog (Changes tab)
- **⌘E / Ctrl+E:** Toggle file tree sidebar

**Mounted dialogs from top bar:**
- `ProjectSettingsDialog`
- `SwitchBranchDialog`
- `GitDiffDialog` (branch name from live git or profile)

---

### 4.2 SwitchBranchDialog

| Max width | ~28rem |
| Padding | Header/content split, no outer padding on content wrapper |

```
SwitchBranchDialog
├── Header (border-bottom, px-16 py-12)
│   └── Title: "Switch branch" + branch icon
├── Search input (px-12 py-8, h-32, autofocus)
│   └── placeholder: "Search branches…"
└── Scrollable list (max-height min(60dvh, 384px))
    └── BranchRow × N
```

**BranchRow contents:**
- Branch icon (muted)
- Branch name (truncate; bold if current)
- Badges (optional):
  - `current` (secondary) — current branch, row disabled/selected bg
  - `trunk` (outline)
  - `used` (amber outline) — branch in use by another profile, disabled
- Ahead/behind counts: green `↑N`, red `↓N` ( monospace 11px)

**Empty search:** `No branches found`

**Loading:** Centered spinner

**Checkout success toast:** `Switched to {branch}`

---

### 4.3 GitDiffDialog (full-screen modal)

| Size | width `min(88rem, 100vw - 2rem)`, height `min(82dvh, 56rem)` |
| Close button | Hidden in dialog chrome — custom close in header |
| Padding | 0 (full bleed) |

```
GitDiffDialog
├── GitDiffHeader
└── GitDiffContent (flex-1 min-height 0)
```

#### GitDiffHeader

Horizontal bar, border-bottom, padding 16×8:

| Zone | Content |
|------|---------|
| Title | Branch icon + truncated branch name (fallback "main") |
| Center-right | Toggle group `Preview`: `Unified` / `Split` |
| Far right | Ghost icon close button (aria "Close") |

#### GitDiffContent — Master Layout

```
┌──────────────────┬─────────────────────────────────────┐
│ Sidebar 360px    │ Diff pane (flex-1)                   │
│ border-right     │                                      │
│                  │                                      │
│ [Changes|History]  │  File diff viewer OR empty state     │
│                  │                                      │
│ File/commit list │                                      │
│ + commit form    │                                      │
└──────────────────┴─────────────────────────────────────┘
     [Review Queue FAB if comments exist]
```

**Sidebar:** Fixed width 360px, focusable (`tabIndex=0`) for keyboard nav.

**Sidebar tabs:**
- `Changes` (git diff icon)
- `History` (commit icon)

---

### 4.4 Changes Tab (Sidebar)

#### Empty state
Centered: `No changes detected`

#### ChangesFileList

**Sticky header:**
- Tri-state checkbox (include all/none) — aria `All`
- Text: `{count} changed file(s)`
- Optional maximize button (sidebar mode only) — aria `Open diff view`

**File rows (`FileListItem`):**
- Optional checkbox (include in commit)
- Basename (truncate) + parent path (xs muted)
- Change badge (letter in colored square):
  - `A` green — added
  - `D` red — deleted
  - `M` blue — modified
  - `R` amber — rename
- Active row: muted background
- Double-click → open file in editor tab, close diff dialog
- Right-click → context menu portal (fixed 200px):
  - Destructive button: `Discard changes to this file`

**Keyboard (sidebar focused):**
- ↑/↓ — move selection
- Space — toggle include checkbox (changes tab)
- Enter — drill into commit (history tab)
- Backspace/Escape — back from commit file list (history)

#### CommitComposer (bottom, border-top)

| Field | Label | Placeholder |
|-------|-------|-------------|
| Summary | `Summary` | `Describe the changes you're committing` |
| Body | `Description` | `Add an optional extended description` |

Section title: `Commit` (uppercase xs muted)

**Buttons (right-aligned):**
- If no changed files but commits ahead: **Push** button with ahead count + upload icon
- Else: **Commit** button (disabled unless ≥1 file included + non-empty summary)

**Shortcut:** ⌘/Ctrl+Enter in summary/body → commit (if valid)

**Global shortcut:** ⌘/Ctrl+Enter when no local changes but ahead commits → push

---

### 4.5 Changes Tab (Diff Pane)

**Component:** `GitDiffPane` with `@pierre/diffs` FileDiff renderer.

**Font:** Uses terminal font family + size from settings.

**Empty states:**
- No changes: `No changes detected`
- No selection: `Select a file to view changes`

**File header bar:**
- Change badge + truncated path (rename shows `old → new`)
- Green `+N` / red `-N` line counts

**Special views:**
1. **Large diff guardrail** (≥ threshold changed lines, default threshold in utils):
   - Title: `Large diff hidden by default`
   - Description with counts
   - Button: `Load diff anyway`
2. **Rename-only:** Previous path / Current path rows
3. **Binary image:** Side-by-side Before/After preview panes with checkerboard background
4. **Normal diff:** Unified or split per header toggle

**Review comments (changes pane only):**
- Line click/drag selection opens floating composer anchored to selection
- Composer: "Comment on {range}", textarea, "Add to queue" button
- Hardcoded English strings in composer UI

**Review Queue FAB:** Bottom-right when comments exist — button `Review Queue` + count badge (hardcoded English label on FAB).

---

### 4.6 History Tab

#### Commit list (initial)

Scrollable rows:
- Commit message (1 line clamp)
- Hash (mono) + author + relative time (`just now`, `Nm ago`, etc. — hardcoded English)
- Stats: N file(s), +insertions, -deletions

Empty: `No commits found`

#### Commit drill-in

**Header:** Back arrow (aria `Back to commit list`) + message + hash

**File list:** Same `FileListItem` without checkboxes + `{count} changed file(s)`

Empty files: `No file changes`

**Diff pane:** Shows selected commit file diff (no review comments).

---

### 4.7 GitReviewQueueDialog

| Size | width `min(56rem, 100vw-2rem)`, max-height 80vh |

**Header:** `Review Queue` (chat icon)

**Body:** Scrollable list of comment cards, each:
- File path (mono semibold)
- Range badge + "Selected diff" (hardcoded)
- Mini diff preview (max-height 128px)
- "Comment" label + editable textarea
- Delete button (destructive icon)

**Footer:**
- `Copy` (outline) — hardcoded English
- `Copy and clear all` (destructive) — hardcoded English

Success toasts: `Review comments copied` / `Review comments copied and cleared`

---

### 4.8 SidebarGitPanel (compact git in profile sidebar)

Same as Changes sidebar subset:
- `ChangesFileList` with maximize button → opens full GitDiffDialog
- `CommitComposer` below
- No history tab in sidebar mode

Tooltips on file paths disabled in compact mode.

---

## 5. Debug UI

### 5.1 Enabling

**Settings → General → Debug Mode** switch.

When enabled:
- Backend debug log channel starts
- `DebugFloat` FAB appears

### 5.2 DebugFloat

| Property | Value |
|----------|-------|
| Visibility | Only when debug mode enabled |
| Position | Fixed, right 64px, bottom 16px, z-index 50 |
| Shape | Circular icon button |
| Icon | Wrench |
| Aria-label | `Debug Log` |

Click → opens DebugLogDialog.

### 5.3 DebugLogDialog

| Max width | ~32rem (`sm:max-w-lg`) |
| Max height | 70vh |
| Title | `Debug Log` |

```
DebugLogDialog
├── Search input (flex-1) — placeholder "Search logs..."
├── Clear button (trash icon, aria "Clear")
├── Log list (scrollable, flex-1)
│   └── LogRow × N
└── Footer count: "{filtered} / {total}" (xs muted, right)
```

**LogRow columns:**
1. Timestamp `HH:MM:SS.mmm`
2. Level badge: ERROR (destructive), WARN (secondary), INFO (default)
3. Source (muted)
4. Message (break-all)

**Auto-scroll:** Sticks to bottom unless user scrolls up (>40px from bottom).

**Empty filtered:** `No log entries yet`

**Search:** Filters message, source, level (case-insensitive).

### 5.4 Debug Keyboard Shortcut

**⌘⇧D** (macOS) / **Ctrl+Shift+D** (others): Toggle debug panel open/closed (only if debug mode enabled; otherwise no-op).

---

## 6. Updater UI

### 6.1 StartupUpdateCheck

Invisible component mounted in main `App`. On mount:
1. Silent `checkForUpdate`
2. If update available (once per app session): Sonner **info** toast

**Toast contents:**
- Title: `Update {version} is available`
- Description: `Current version {currentVersion}; latest version {version}.`
- Duration: 12 seconds
- Action button: `Open Update Page` → opens settings window on About tab

Toast id: `update-available` (deduped).

### 6.2 About Tab Update Section

See §2.8. Full manual check/install flow with beta toggle.

**Toasts from About actions:**
| Action | Toast |
|--------|-------|
| Copy version | `Version copied to clipboard` |
| Check — update found | info: update available title + description |
| Check — up to date | info: already up to date |
| Check — error | error: update check failed + message |
| Install — error | error: update failed + message |

### 6.3 Updater Backend Config

- Endpoint: GitHub releases `latest.json`
- Beta channel controlled by `acceptBetaUpdates` setting

---

## 7. Remaining Dialogs & Overlays

### 7.1 CreateProjectDialog

| Title | `Create Project` (folder-plus icon) |

**Flow:**
1. Initial: dashed bordered drop zone — folder icon + `Choose Folder`
2. After folder selected: folder path in monospace box + small `Choose Folder` edit button
3. Project name field — label `Project Name`, placeholder `Optional. Leave empty to use folder name`
4. Dynamic hint text (one of three i18n hints based on state)

**Footer:** `Cancel` | `Create` (disabled without folder or while pending)

Enter in name field submits.

---

### 7.2 DeleteProjectDialog

| Title | `Delete Project` (trash icon) |
| Body | `Are you sure you want to delete this project? This action cannot be undone.` |
| Footer | `Cancel` | `Delete` (destructive) |

---

### 7.3 RenameProjectDialog

| Title | `Rename` (pencil icon) |
| Field | `New Name` |
| Footer | `Cancel` | `Rename` (disabled if empty or unchanged) |

Autofocuses rename input on open.

---

### 7.4 ProjectSettingsDialog

| Max width | ~32rem |
| Title | `Project Settings` (gear icon) |

**Tabs:**
1. **Scripts** (code icon)
2. **Templates** (terminal icon)

**Scripts tab fields:**
| Field | Label | Description |
|-------|-------|-------------|
| Worktree dir | `Worktree Directory` | Overrides global default… |
| Init script | `Init Script` | Injected into every new terminal session |
| Setup script | `Setup Script` | Runs when creating profile |
| Teardown script | `Teardown Script` | Runs when deleting profile |

All script fields: monospace textarea 4 rows, placeholder `One command per line…`

**Templates tab:** `ProjectTemplatesEditor` — same list/edit pattern as global templates but with cwd field in draft dialog (`showCwd=true`).

**Footer:** `Cancel` | `Save`

Loading: centered spinner min-height 200px.

---

### 7.5 CreateProfileDialog

| Title | `New Profile` (branch icon) |
| Field | `Branch Name`, placeholder `Optional. Leave empty to auto-generate…` |
| Footer | `Cancel` | `Create` |

---

### 7.6 DeleteProfileDialog

| Title | `Delete Profile` (trash icon) |
| Body | `Are you sure you want to delete this profile? The git worktree will be removed.` |

**Conditional blocks while checking git:**
- Spinner + `Checking this profile's Git status…`
- Warning alert with aggregated diff/commit warnings
- Error alert if git check failed

**Footer:** `Cancel` | `Delete` or `Delete Anyway` (if risky)

---

### 7.7 UnsavedFileCloseDialog

| Title | `Close Unsaved File?` (warning icon) |
| Body | `{file} has unsaved changes. Closing it will discard those changes.` |
| Footer | `Cancel` | `Discard Changes` (destructive) |

Triggered from terminal tab bar when closing dirty file tab.

---

### 7.8 Context Menu Overlay (ChangesFileList)

Not a dialog — fixed portal at cursor:
- 200px wide popover
- Single destructive action: `Discard changes to this file`
- Closes on outside click, Escape, blur, resize

---

### 7.9 Floating Review Comment Composer (GitDiffPane)

Fixed-position popover (not modal) anchored to selected diff lines:
- Header: comment range + cancel
- Textarea
- "Add to queue" button

---

### 7.10 Command Palette (attached to profile)

Overlay search for files — triggered **⌘K / Ctrl+K**. Out of detailed scope but exists in `ProfileLayout`.

---

## 8. Global Toast System

**Component:** Sonner `Toaster` in both windows.

**Used for:** Update notifications, git operations, clipboard confirmations, review queue copy, agent-adjacent feedback, file tree errors, etc.

Standard patterns:
- `toast.success(title, { description })`
- `toast.error(title, { description })`
- `toast.info(title, { description, action: { label, onClick } })`

---

## 9. Cross-Cutting Platform Differences

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Main window title bar | Overlay + traffic lights at (16,24) | Standard decorations; extra topbar right padding 118px for window controls | Standard decorations |
| Custom window controls | No (traffic lights in overlay) | Yes (`WindowControls` component) | No |
| Settings shortcut | ⌘, | Ctrl+, | Ctrl+, |
| Debug toggle | ⌘⇧D | Ctrl+Shift+D | Ctrl+Shift+D |
| Terminal new/close tab | ⌘T / ⌘W (metaKey only in code) | Same binding checks metaKey | Same |
| Terminal search | ⌘F | Ctrl+Shift+F | Ctrl+Shift+F |
| Font listing | Core Text | fontdb | fontdb |
| Sound listing | `/System/Library/Sounds` | `C:\Windows\Media` | XDG sound dirs |
| Notification permission | Tauri notification plugin prompt on enable | Same | Same |
| File reveal | "Reveal in Finder" tooltip on project name | Platform file manager via backend | Platform file manager |

**Settings window:** Uses standard system title bar with title text "Settings" (not overlay style).

**Browser list for links:** From `listInstalledBrowsers` when link confirm opens.

---

## 10. Keyboard Shortcuts Summary

| Shortcut | Context | Action |
|----------|---------|--------|
| ⌘, / Ctrl+, | Global (main window) | Open settings window |
| ⌘⇧D / Ctrl+⇧D | Global | Toggle debug log dialog |
| ⌘T | Active profile | New terminal tab |
| ⌘W | Active profile | Close active terminal tab |
| ⌘G / Ctrl+G | Active profile top bar | Open git diff dialog |
| ⌘E / Ctrl+E | Active profile top bar | Toggle sidebar |
| ⌘K / Ctrl+K | Active profile | Command palette |
| ⌘F | Terminal focus (macOS) | Terminal search |
| Ctrl+Shift+F | Terminal focus (Win/Linux) | Terminal search |
| ⌘=/⌘+ / ⌘- | Terminal (macOS) | Font size |
| Ctrl+L | Terminal | Clear screen |
| ⌘←/→ | Terminal (macOS) | Home/End to PTY |
| Alt+←/→ | Terminal | Word motion |
| Shift+Enter | Terminal | Newline to PTY |
| ↑/↓/Space/Enter | Git diff sidebar | Navigate/toggle/select |
| ⌘/Ctrl+Enter | Git commit form | Commit |
| ⌘/Ctrl+Enter | Git diff (no changes, ahead) | Push |
| Escape | Terminal search / git contexts | Close/back |

---

## Appendix A — Persisted Settings Defaults

| Store | Key | Default |
|-------|-----|---------|
| terminalSettings | fontFamily | JetBrains Mono |
| terminalSettings | fontSize | 13 |
| terminalSettings | darkTerminalTheme | github-dark |
| terminalSettings | lightTerminalTheme | github-light |
| terminalSettings | syncTerminalTheme | false |
| terminalSettings | showAllFonts | false |
| terminalSettings | defaultShell | from `DEFAULT_TERMINAL_SHELL` |
| themeStore | borderRadius | sm |
| notificationStore | enabled | false |
| notificationStore | sound | Ping |
| sidebarSettings | showProjectAvatars | true |
| worktreeSettings | defaultWorktreeDir | "" (empty → ~/.2code/workspace) |
| updaterSettings | acceptBetaUpdates | false |
| debugStore | enabled | false |
| terminalTemplates | templates | [] |

---

## Appendix B — Hardcoded Non-i18n Strings

These appear in UI without `en.json` entries:

| Location | String |
|----------|--------|
| Terminal.tsx | Toast: "Text copied" |
| GitDiffContent.tsx | FAB: "Review Queue" |
| GitReviewQueueDialog | "Copy", "Copy and clear all", "Selected diff", "Comment", "Comment on …", "Add to queue" |
| GitDiffPane comment composer | "Add to queue", "Cancel review comment" |
| GitDiffHeader | Close aria-label: "Close" |
| CommitList | Relative time: "just now", "Nm ago", "file/files" |
| TerminalTabs | "Dismiss completion notification", "Close {title}" |
| TopBarPreview | Mock text: "My Project", "main" |

---

*Document generated from codebase inspection. Branch: settings/terminal/git/debug/updater components as specified in exploration task.*
