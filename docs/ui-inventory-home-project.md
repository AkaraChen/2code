# 2code UI Inventory — Home, Project Detail, Profile Layout, File Tree/Viewer, Notes, Dialogs

Framework-agnostic inventory derived from source files listed in the exploration task. Numeric sizes and class names are taken directly from code. English labels reference `messages/en.json` keys and resolved text.

---

## 1. Global routing context

| Route | Page component | Notes |
|-------|----------------|-------|
| `/` | `HomePage` | Auto-redirects to first project's default profile when projects exist |
| `/projects/:id/profiles/:profileId` | `ProjectDetailPage` + persistent `TerminalLayer` overlay | Invalid/missing profile redirects to default profile or `/` |

**Project detail rendering split:**

- **`TerminalLayer`** (absolute overlay, `inset: 0`, `display: flex/none` per active profile): renders `ProfileLayout` + `TerminalTabs` for every profile that has open terminal or file tabs.
- **`ProjectDetailPage`**: only mounts `ProfileLayout` + `TerminalTabs` when **both** terminal tabs and file tabs are empty (`shouldRenderEmptyState`), showing the empty-terminal CTA. Once any tab opens, `TerminalLayer` owns the view; `ProjectDetailPage` renders `null`.

---

## 2. Home Page (`HomePage.tsx`)

### 2.1 Component tree

```
HomePage (root: div.h-full)
├── header (data-tauri-drag-region)
│   ├── FolderIcon (Phosphor, className: size-4 text-muted-foreground)
│   └── h1 (select-none text-sm font-semibold) → i18n: home ("Home")
├── [conditional: hasNoProjects]
│   └── div (flex h-[calc(100%-52px)] items-center justify-center)
│       └── Empty
│           └── EmptyHeader
│               ├── EmptyMedia variant="icon" → FolderPlusIcon
│               ├── EmptyTitle → emptyProjectsTitle ("No projects yet")
│               └── EmptyDescription → emptyProjectsDesc
└── TourOnboarding (renders null; driver.js overlay when enabled)
```

### 2.2 Layout regions

| Region | Dimensions / classes | Behavior |
|--------|---------------------|----------|
| Page root | `h-full` | Fills main content area beside app sidebar |
| Header bar | `h-[52px]`, `border-b`, `px-5`, `flex items-center gap-2` | macOS draggable title region |
| Empty state area | `h-[calc(100%-52px)]`, centered flex | Only when `projects.length === 0` |
| Content when projects exist | Header only visible briefly | `useEffect` navigates to `/projects/{id}/profiles/{defaultProfileId}` with `replace: true` |

### 2.3 Interactive states

| State | UI |
|-------|-----|
| No projects | Centered empty state with folder-plus icon |
| Has projects | Immediate redirect; user rarely sees Home content except header flash |
| Onboarding tour active | driver.js popover anchored to `#add-project-button` in app sidebar (not in HomePage DOM) |

### 2.4 TourOnboarding (`TourOnboarding.tsx`)

- **Trigger:** `isEnabled={hasNoProjects}` on HomePage.
- **Library:** driver.js (`driver-popover-theme` class).
- **Single step:** targets `#add-project-button` (in `AppSidebar.tsx`).
- **Popover:** side `right`, align `start`; title `onboardingTourTitle`, description `onboardingTourDesc`; buttons: close only.
- **Dismiss:** clicking add-project button destroys tour.
- **Delay:** 300ms before `drive()`.
- **Renders:** `null` (no visible React output).

### 2.5 Keyboard shortcuts

None defined on HomePage.

---

## 3. Project Detail Page (`ProjectDetailPage.tsx`)

### 3.1 Component tree (empty state path)

```
ProjectDetailPage
└── [when !hasTabs && !hasFileTabs]
    └── ProfileLayout
        └── TerminalTabs
            ├── Tab bar (empty)
            └── emptyFallback → emptyTerminalState
                └── Empty (centered)
                    ├── EmptyHeader
                    │   ├── EmptyMedia icon → TerminalWindowIcon
                    │   ├── EmptyTitle → noTerminalsOpen
                    │   └── EmptyDescription → noTerminalsOpenDescription
                    └── EmptyContent
                        └── div.flex
                            ├── Button (New Terminal) [+ PlusIcon, newTerminal]
                            └── [optional] DropdownMenu (template picker)
                                ├── DropdownMenuTrigger → Button size="icon" [-ml-px rounded-l-none, aria-label="Choose template"]
                                │   └── CaretDownIcon
                                └── DropdownMenuContent (min-w-56 p-1)
                                    └── TerminalTemplateDropdownContent
```

### 3.2 Redirect logic (no visible UI)

- Missing project → `<Navigate to="/" replace />`
- Missing profile → redirect to default profile or first profile, else `/`

### 3.3 Empty terminal CTA buttons

| Control | Label (i18n) | Classes / props | Disabled when |
|---------|--------------|-----------------|---------------|
| Primary | `newTerminal` ("New Terminal") | `Button`; if templates exist: `rounded-r-none` | `createTab.isPending` |
| Template split | (icon only) | `Button` `size="icon"`, `-ml-px rounded-l-none`, `aria-label="Choose template"` | same |

### 3.4 Keyboard shortcuts (via `TerminalLayer`, active profile)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+T` | Create new terminal tab |
| `Cmd/Ctrl+W` | Close active terminal tab |

---

## 4. Profile Layout (`ProfileLayout.tsx`)

### 4.1 Component tree

```
ProfileLayout (div.flex.h-full.flex-col)
├── CommandPalette (modal, always mounted)
├── div.border-b
│   └── ProjectTopBar
└── div.flex.min-h-0.min-w-0.flex-1
    ├── ProfileSidebar
    └── div.min-h-0.min-w-0.flex-1
        └── {children}  → TerminalTabs
```

### 4.2 Local state

| State | Default | Purpose |
|-------|---------|---------|
| `fileTreeOpen` | `true` | Sidebar panel visible |
| `sidebarMode` | `"files"` | `"files" \| "git" \| "notes"` |

### 4.3 Sidebar toggle behavior

- **`onToggleFileTree`:** flips `fileTreeOpen`.
- **`onSidebarModeChange(mode)`:**
  - If sidebar open AND same mode clicked → close sidebar.
  - Else set mode and open sidebar.

### 4.4 File open handler

`openFileTab(profile.id, filePath)` → `useFileViewerTabsStore.openFile`.

---

## 5. Profile Sidebar (`ProfileSidebar.tsx`)

### 5.1 Component tree

```
ProfileSidebar (div.h-full.shrink-0)
└── motion.div (animated width)
    ├── [files mode, display block/none] FileTreePanel
    ├── [mode === git] SidebarPanelContent → SidebarGitPanel
    ├── [mode === notes] SidebarPanelContent
    │   └── div → ProfileNotesEditor (lazy)
    └── [isOpen] resize separator (role="separator")
```

### 5.2 Width & animation constants

| Constant | Value |
|----------|-------|
| `SIDEBAR_PANEL_MIN_WIDTH` | 180px |
| `SIDEBAR_PANEL_MAX_WIDTH` | 560px |
| `DEFAULT_SIDEBAR_PANEL_WIDTH` | 208px |
| `SIDEBAR_PANEL_STORAGE_KEY` | `"file-tree-panel"` (localStorage JSON `{ state: { panelWidth }, version: 2 }`) |
| Spring transition | stiffness 320, damping 34, mass 0.9 |
| Closed width | 0 (animate) |
| Reduced motion | `{ duration: 0 }` |

### 5.3 Resize handle

| Property | Value |
|----------|-------|
| `aria-label` | `profileSidebarResizeSeparator` ("Resize sidebar") |
| `aria-orientation` | `vertical` |
| `aria-valuemin/max/now` | 180 / 560 / current width |
| `tabIndex` | 0 |
| Classes | `absolute top-0 -right-1 bottom-0 z-[1] w-2 cursor-col-resize focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]` |
| Pointer | `useHorizontalResize` drag |
| Keyboard | ArrowLeft/Right ±16px; Home=min; End=max |

### 5.4 Pointer events when closed

- Container: `pointerEvents: none`, `aria-hidden={true}` when closed.

### 5.5 SidebarPanelContent wrapper

```
div.flex.min-h-0.min-w-0.flex-1.flex-col.overflow-hidden.border-r
└── AsyncBoundary
    ├── fallback: LoadingSpinner
    ├── error: LoadingError
    └── children
```

### 5.6 Git mode panel (`SidebarGitPanel` — child, not in read list but mounted here)

```
div.flex.min-h-0.min-w-0.flex-1.flex-col.overflow-hidden
├── ChangesFileList (scrollable file list + commit inclusion)
└── CommitComposer (summary, body, commit/push)
```

**ChangesFileList header (sticky):**

- Master checkbox (include all/none) → `gitCommitIncludeAll` aria-label
- Text: `changedFiles({ count })`
- Optional maximize button → `gitOpenDiffView`, `ArrowsOutSimpleIcon`, `size-6`
- Empty: `noChangesDetected`

**Keyboard:** none specific to sidebar git panel.

---

## 6. Sidebar Mode Switch (`SidebarModeSwitch.tsx`)

### 6.1 Component tree

```
Tabs (value = isOpen ? mode : null)
└── TabsList (h-7)
    └── [for each mode: files, git, notes]
        └── Tooltip
            └── TooltipTrigger → TabsTrigger (px-2, aria-label=label)
                ├── Icon (size-3.5): FolderSimpleIcon | GitBranchIcon | NoteIcon
                └── [git only, if diffStats] +{additions} (text-green-500) -{deletions} (text-red-500)
```

### 6.2 Mode labels (i18n)

| Mode | Key | English |
|------|-----|---------|
| files | `sidebarFilesTab` | Files |
| git | `sidebarGitTab` | Git |
| notes | `notes` | Notes |

### 6.3 Interaction

- Click tab → `onModeChange(value)` (also wired to Tabs `onValueChange`).
- Git tab shows live diff stat badges when `useGitDiffStats(profileId, isActive)` returns data.
- When sidebar closed, `Tabs` value is `null` (no tab appears selected).

---

## 7. File Tree Panel (`FileTreePanel.tsx`)

### 7.1 Component tree

```
FileTreePanel (div.flex.h-full.min-h-0.min-w-0.overflow-hidden)
└── motion.div (opacity/x slide when isOpen)
    └── div.relative.min-h-0.min-w-0.flex-1.border-r.px-1.5.py-1
        ├── FileTree (@pierre/trees)
        │   └── renderContextMenu → FileTreeContextMenu
        ├── [rootContextMenu] FileTreeRootContextMenu
        └── [isTreePathsError] error overlay (absolute inset-0, pointer-events-none)
            └── p.text-xs.text-muted-foreground (error message)
```

### 7.2 Pierre FileTree configuration

| Option | Value |
|--------|-------|
| `density` | `"compact"` |
| `flattenEmptyDirectories` | `false` |
| `icons` | `"complete"` |
| `initialExpansion` | `"closed"` |
| `stickyFolders` | `true` |
| Drag-and-drop | move within tree; also terminal drop payload |
| Renaming | inline; draft create uses `startRenaming(..., { removeIfCanceled: true })` |

### 7.3 CSS variables (`FILE_TREE_HOST_STYLE`)

| Variable | Value |
|----------|-------|
| `--trees-font-size-override` | `13px` |
| `--trees-level-gap-override` | `12px` |
| `--trees-border-radius-override` | `4px` |
| `--trees-item-margin-x-override` | `4px` |
| `--trees-item-padding-x-override` | `4px` |
| `--trees-padding-inline-override` | `4px` |
| `--trees-bg-override` | `transparent` |
| `--trees-selected-bg-override` | `var(--muted)` |
| Host padding | `px-1.5 py-1` on wrapper |

### 7.4 Animation

| Property | Open | Closed |
|----------|------|--------|
| opacity | 1 | 0 |
| x | 0 | -12 |
| duration | 0.18s ease `[0.22, 1, 0.36, 1]` | same / 0 if reduced motion |

### 7.5 Tree item interaction

| Action | Behavior |
|--------|----------|
| Click file | Opens in file viewer tab (`onOpenFile`) |
| Click directory | Expand/collapse |
| Selection change (keyboard) | Opens single selected file unless suppressed |
| MouseDown | Suppresses auto-open on selection (multi-select) |
| Meta/Ctrl/Shift click | Does not auto-open on selection |
| Drag start | Writes terminal drop payload; suppresses click-open 500ms |
| KeyUp on focused dir | Sync expand/collapse state |

**Draft create names:** `"New File"`, `"New Folder"` (English hardcoded in `FILE_TREE_CREATE_NAMES`).

### 7.6 Context menu — item (`FileTreeContextMenu`)

Rendered via `FileTreeMenu` → Base UI Menu portal.

| Item | i18n key | Enabled when |
|------|----------|--------------|
| Open | `fileTreeContextMenuOpen` | file kind + in filePathSet |
| Open in Default App | `fileTreeContextMenuOpenInDefaultApp` | path deletable/exists |
| Reveal in Finder | `fileTreeContextMenuRevealInFileManager` | same |
| — separator — | | |
| Refresh | `fileTreeContextMenuRefresh` | !isRefreshing |
| — separator — | | |
| New File | `fileTreeContextMenuNewFile` | always |
| New Folder | `fileTreeContextMenuNewFolder` | always |
| Rename | `rename` | single path in tree |
| — separator — | | |
| Copy Relative Path | `fileTreeContextMenuCopyRelativePath` | always |
| Copy Absolute Path | `fileTreeContextMenuCopyAbsolutePath` | always |
| — separator — | | |
| Delete | `delete` | all selected deletable; variant destructive |

**Popup classes:** `z-50 max-h-[var(--available-height)] min-w-40 overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10`.

### 7.7 Context menu — empty/root area (`FileTreeRootContextMenu`)

| Item | i18n |
|------|------|
| New File | `fileTreeContextMenuNewFile` |
| New Folder | `fileTreeContextMenuNewFolder` |
| Refresh | `fileTreeContextMenuRefresh` |
| Reveal in Finder | `fileTreeContextMenuRevealInFileManager` |
| Copy Relative Path (`.`) | `fileTreeContextMenuCopyRelativePath` |
| Copy Absolute Path (root) | `fileTreeContextMenuCopyAbsolutePath` |

### 7.8 Loading / error states

| State | UI |
|-------|-----|
| Tree paths loading | Pierre tree empty until data (no explicit spinner in panel) |
| Tree paths error | Centered overlay text: error message, `text-xs text-muted-foreground` |
| Create failure toast | `fileTreeCreateErrorTitle` + description |
| Delete failure toast | `fileTreeDeleteErrorTitle` + description |
| Refresh failure toast | `somethingWentWrong` |

### 7.9 Git status integration

- Status-only paths appear in tree (including deleted, ignored).
- Deleted files: visible but not openable on click.
- Status badges rendered by Pierre model via `setGitStatus`.

### 7.10 Query gating

When `!isOpen || !isActive`: file tree and git status queries disabled.

---

## 8. File Viewer (`FileViewerPane.tsx` + tab integration in `TerminalTabs.tsx`)

### 8.1 Tab bar integration

File tabs share the horizontal tab strip with terminal tabs.

**File tab trigger (`TabsTrigger`):**

```
TabsTrigger (max-w-56 flex-none justify-start, nativeButton=false, render=<div/>)
├── FileTreeFileIcon (size=14)
├── span.truncate (filename title)
├── [if dirty] span.size-2.rounded-full.bg-muted-foreground (unsaved dot)
└── TabCloseButton (XIcon size-3, aria-label="Close {title}")
```

**Terminal tab trigger:** same layout class; terminal/agent icon; optional `AgentStatusDot`; close button.

**Trailing control:** `TerminalTemplateMenu` (+ new terminal / templates dropdown).

**Tab strip container:** `flex w-full min-w-0 items-center overflow-x-auto overflow-y-hidden border-b p-0`.

### 8.2 FileViewerPane decision tree

```
FileViewerPane
├── [previewableBinaryFile] → FilePreviewPane
├── [loading && !hasLoadedFile] → Spinner in h-32 center
├── [error && !hasLoadedFile] → error text h-32 center
├── [!hasLoadedFile] → null
├── [.md/.mdx] → MarkdownEditor
└── else → Monaco Editor
```

### 8.3 Monaco editor pane

| Property | Value |
|----------|-------|
| Container | `div.h-full.min-h-0.overflow-hidden` ref for save focus |
| Height | `100%` |
| Theme | `light` or `vs-dark` from terminal theme id |
| Font | terminal settings `fontFamily`, `fontSize` |
| Options | minimap off; padding top/bottom 12; ligatures; wordWrap off; no TS/JS validation |
| Loading | centered Spinner |
| Unsaved | tracked in `fileViewerDirtyStore`; 400ms draft debounce (`DRAFT_SYNC_DELAY_MS`) |

### 8.4 Markdown file pane

Uses `MarkdownEditor` with `editorKey={filePath}`, `saveStatus` from save mutation (`saving` \| `idle`).

### 8.5 FilePreviewPane (binary/archive/image/pdf)

**Header:** `min-h-9`, `border-b`, `bg-muted`, `px-3`

| Element | Content |
|---------|---------|
| Left | filename, `truncate text-sm font-medium` |
| Right | `"Office Preview"` if kind `office-pdf`, else hardcoded `"Preview"` (not i18n) |

**Archive:** `ArchivePreviewTree` instead of generic preview.

**Image:** checkerboard background grid, `object-fit: contain`, max dimensions 100%.

**PDF:** full-size iframe, white background, border 0.

**Loading:** Spinner centered.

**Error:** `text-sm text-muted-foreground` centered, max-w-lg.

**Unavailable:** hardcoded `"Preview unavailable"`.

**Previewable extensions:** images (png, jpg, …), pdf, office docs, archives (.zip, .tar, .tar.gz, .tgz, .gz).

### 8.6 ArchivePreviewTree

```
div.flex.h-full.min-h-0.flex-col.overflow-hidden
├── header (min-h-9, border-b, bg-muted, px-3)
│   ├── filename (truncate text-sm font-medium)
│   └── "{fileCount} files / {directoryCount} folders" (hardcoded English)
└── FileTree (read-only, initialExpansion open, same 13px tree styles)
```

### 8.7 Terminal vs file content visibility

- File viewer: conditionally rendered when `fileTabActive && activeFilePath`.
- Terminals: **never unmounted**; parent `display: none` when file tab active; each terminal `visibility hidden` except active tab.

### 8.8 Unsaved close dialog (`UnsavedFileCloseDialog`)

**Trigger:** closing file tab while path in `dirtyFilePathSet`.

| Element | i18n |
|---------|------|
| Title | `closeUnsavedFileTitle` + WarningCircleIcon |
| Body | `closeUnsavedFileDescription({ file })` |
| Cancel | `cancel` |
| Discard | `discardChanges` (destructive) |

### 8.9 Keyboard shortcuts (file editor)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | Save (window listener + Monaco command) |

---

## 9. Markdown Editor (`MarkdownEditor.tsx`)

Used by profile notes and `.md`/`.mdx` file tabs.

### 9.1 Component tree

```
MarkdownEditor (div.milkdown-wrapper.h-full.overflow-hidden)
└── MilkdownProvider
    └── MilkdownEditor (div.flex.h-full.min-h-0.flex-col)
        ├── MarkdownToolbar
        └── div.min-h-0.flex-1.overflow-y-auto.p-4
            └── Milkdown (ProseMirror)
```

### 9.2 Toolbar layout (`MarkdownToolbar`)

Container: `flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-background px-2 py-1`.

**Sections left → right:**

1. **Command menu dropdown** (`notesCommandMenu`, ListIcon) — block types, quote, code block, table, divider.
2. **Separator** vertical `h-5`.
3. **Inline formatting buttons** (ghost icon-xs, active: `bg-muted text-foreground`):
   - Bold (`notesFormatBold` + hint `⌘B`)
   - Italic (`notesFormatItalic` + `⌘I`)
   - Code (`notesFormatCode` + `⌘E`)
   - Strike (`notesFormatStrike`, renders "S" with line-through)
   - Link (`notesFormatLink`)
4. **Separator**
5. **List/quote buttons:** bullet list, ordered list (shows "1."), quote.
6. **Separator**
7. **Table menu** (`notesTableMenu`, TableIcon): insert table, add row/col, delete cells.
8. **Link editor inline** (when open): Input placeholder `https://`, apply (CheckIcon), remove (XIcon).
9. **SaveStatusIndicator** (flex-1 justify-end): Badge with Saving/Saved/Failed.

### 9.3 Save status badge

| Status | Icon | Label | Badge variant |
|--------|------|-------|---------------|
| saving | FloppyDiskIcon | `notesSaving` | secondary |
| saved | CheckIcon | `notesSaved` | default |
| failed | WarningCircleIcon | `notesSaveFailedShort` | destructive |
| idle | (spacer flex-1) | — | — |

### 9.4 Slash command menu (typing `/`)

Floating menu class `markdown-editor-slash-menu` with items: Paragraph, H1–H3, bullet/ordered list, quote, code block, table (3×3), divider.

### 9.5 Placeholder

CSS `data-placeholder` on empty paragraph; default i18n `notesPlaceholder` ("Write notes for this profile…") or prop override.

### 9.6 Auto-save timing

- Markdown change debounce: **650ms** before `onMarkdownChange`.
- Profile notes: saves via API on change (see ProfileNotesEditor).

### 9.7 Keyboard

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+S` | `onRequestSave` when pane focused (file tabs); notes editor omits handler unless passed |

---

## 10. Profile Notes (`ProfileNotesEditor.tsx`)

### 10.1 Component tree

```
ProfileNotesEditor
└── MarkdownEditor
    editorKey={profile.id}
    initialMarkdown={profile.notes}
    placeholder={notesPlaceholder}
    saveStatus={saveStatus from local state}
```

### 10.2 Save behavior

- On markdown change (after editor debounce): calls `useUpdateProfileNotes` mutation.
- Status flow: `idle` → `saving` → `saved` (1.6s) → `idle`, or `failed` on error toast `notesSaveFailedTitle`.
- Skips save if markdown equals last saved.

### 10.3 Layout

Fills sidebar panel: `min-h-0 flex-1 overflow-hidden` inside `SidebarPanelContent`.

---

## 11. Command Palette (`CommandPalette.tsx`)

### 11.1 Component tree

```
Command.Dialog (cmdk)
├── [header] div.border-b.px-4.py-3
│   └── Command.Input (placeholder, aria-label)
├── Command.List (max-h-[60vh] overflow-y-auto p-1)
│   ├── [error] CommandPaletteStatusMessage
│   ├── [empty] CommandPaletteEmptyState
│   └── CommandPaletteResultList
│       └── CommandPaletteResultItem × N
│           ├── FileTreeFileIcon (16)
│           ├── name (truncate text-sm)
│           └── parent path (truncate text-xs muted)
```

### 11.2 CSS (`app.css`)

| Class | Styles |
|-------|--------|
| `project-command-palette__overlay` | fixed inset-0, z-index 1400, rgba(0,0,0,0.4) |
| `project-command-palette__dialog` | fixed, top 72px, centered, padding-inline 12px, z-index 1401 |
| `project-command-palette__root` | width min(100%, 40rem), max-height calc(100vh - 96px), border-radius 8px, popover background |

### 11.3 Result item

Classes: `flex min-w-0 select-none items-center gap-2 rounded px-3 py-2 data-[selected=true]:bg-muted`.

### 11.4 Empty / error messages

| Condition | Message |
|-----------|---------|
| No search, no results | `commandPaletteEmpty` |
| Search, no results | `commandPaletteNoResults` |
| API error, no cached results | error text via `getErrorMessage` |

### 11.5 Keyboard

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+K` | Open palette (capture phase, active profile only) |
| Arrow keys | Navigate results (cmdk `loop`) |
| Enter | Open selected file, close palette |
| Escape | Close (via onOpenChange) |

**Note:** i18n keys `commandPaletteHint`, `commandPaletteOpenHint`, `commandPaletteFooterHint`, `commandPaletteResultCount` exist in en.json but are **not rendered** in current CommandPalette UI.

---

## 12. Project Top Bar (`ProjectTopBar.tsx`)

### 12.1 Component tree

```
ProjectTopBar
├── div[data-tauri-drag-region] (relative flex min-h-[44px] items-end justify-between px-4 pt-1 pb-1.5)
│   ├── leftContent
│   ├── titleContent (absolute centered)
│   └── controlsContent
├── ProjectSettingsDialog
├── SwitchBranchDialog
└── GitDiffDialog (branch-aware for default profile)
```

### 12.2 Bar padding (platform)

| Platform / state | Class |
|------------------|-------|
| Windows | `pr-[118px]` |
| Default | `pr-5` |
| macOS + collapsed app sidebar | `pl-[84px]` |

### 12.3 Left region

| Element | When | Details |
|---------|------|---------|
| Expand sidebar button | App sidebar collapsed | `SidebarSimpleIcon`, ghost icon button, `expandSidebar` |
| SidebarModeSwitch | Always when props provided | see §6 |

### 12.4 Center title region

Classes: `pointer-events-none absolute inset-x-0 bottom-1.5 flex min-w-0 items-center justify-center gap-2 px-32`.

| Element | Content |
|---------|---------|
| Project name button | `truncate font-semibold`; click → reveal worktree in file manager; tooltip shows `profile.worktree_path` |
| Branch button | `switchBranchTitle` aria-label |

**Branch display rules:**

- **Default profile + active:** live `GitBranchLabel` (fetched branch name) with GitBranchIcon.
- **Default profile + inactive:** no branch label shown.
- **Non-default profile:** static `profile.branch_name` with GitBranchIcon.

### 12.5 Right controls

- Dynamic topbar controls from registry (`visibleActiveControls`).
- Settings gear: `projectSettings`, secondary icon button.

### 12.6 Topbar control components (`controls.tsx`)

| Control ID | Button | Label pattern | Action |
|------------|--------|---------------|--------|
| github-desktop | icon-sm secondary | `topbarGithubDesktop` | Open GitHub Desktop at worktree |
| editor | icon-sm secondary | `topbarEditor` · {app name} | Open configured editor app |
| terminal | icon-sm secondary | `topbarTerminal` · {app name} | Open configured terminal app |
| pr-status | xs secondary with text | `#N {state}` | Open PR URL; tooltip `topbarPrTooltip` |

**PR states:** Draft, Open, Merged, Closed (`topbarPrDraft/Open/Merged/Closed`).

### 12.7 Keyboard shortcuts (active profile)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+G` | Open Git diff dialog (changes tab) |
| `Cmd/Ctrl+E` | Toggle file tree sidebar (`onToggleFileTree`) |

---

## 13. Top Bar Settings UI (`topbar/*.tsx`)

Configured in app Settings page, not on project detail directly.

### 13.1 TopBarSettings

```
div.flex.max-w-2xl.flex-col.gap-6
├── hint text (topbarDragHint)
├── DndContext
│   ├── TopBarPreview
│   ├── AvailableControls
│   └── DragOverlay → DraggableControl
├── Editor app NativeSelect (if apps detected)
├── Terminal app NativeSelect
└── Reset button (topbarResetDefaults)
```

**Loading:** `topbarDetectingApps`.

### 13.2 TopBarPreview

Mock bar: "My Project" + branch "main" + draggable active controls or `topbarNoControls`.

### 13.3 AvailableControls

Dashed border drop area; inactive controls or `topbarAllControlsActive`.

### 13.4 DraggableControl

`rounded-md border bg-muted p-2`; grab cursor; DotsSixVerticalIcon + control icon (16px); dragging opacity 0.4.

---

## 14. Dialogs — Projects

### 14.1 CreateProjectDialog

**Open triggers:** App sidebar "New Project" button (`#add-project-button`).

| Element | Details |
|---------|---------|
| Title | FolderPlusIcon + `createProject` |
| Empty folder state | Dashed border button, FolderIcon size-6, `chooseFolder` |
| Selected folder | Label `folder`, outline xs button to re-pick, `code` block with path |
| Field | `projectName` input, placeholder `projectNamePlaceholderFolder` |
| Description | Dynamic hint from folder/name state |
| Footer | Cancel + Create (Spinner when pending) |

**Validation:** Create disabled until folder selected.

**Success:** navigates to new project's first profile.

**Enter key:** submits from name field.

### 14.2 DeleteProjectDialog

**Open trigger:** Project context menu in sidebar (`ProjectMenuItem`).

| Element | i18n |
|---------|------|
| Title | TrashIcon + `deleteProject` |
| Body | `confirmDeleteProject` |
| Cancel | `cancel` |
| Delete | `delete` (destructive, Spinner when pending) |

### 14.3 RenameProjectDialog

**Open trigger:** Project context menu → Rename.

| Element | i18n |
|---------|------|
| Title | PencilSimpleIcon + `renameProject` |
| Field | `newName` |
| Submit disabled | empty or unchanged name |
| Buttons | `cancel`, `rename` |

**Focus:** `[data-rename-input]` on open.

### 14.4 ProjectSettingsDialog

**Open trigger:** Project context menu → Settings; also gear in ProjectTopBar.

| Element | Details |
|---------|---------|
| Content width | `sm:max-w-lg` |
| Title | GearSixIcon + `projectSettings` |
| Loading | Spinner min-h-[200px] |
| Error | DialogBodyError |

**Tabs:**

| Tab | Icon | Content |
|-----|------|---------|
| scripts (default) | CodeIcon | Worktree dir + init/setup/teardown script textareas |
| templates | TerminalWindowIcon | ProjectTemplatesEditor |

**Scripts tab fields:**

| Field | Label | Description key |
|-------|-------|-----------------|
| worktreeDir | `projectWorktreeDir` | `projectWorktreeDirDesc`, placeholder `projectWorktreeDirPlaceholder` |
| initScript | `initScript` | `initScriptDesc`, 4-row mono textarea |
| setupScript | `setupScript` | `setupScriptDesc` |
| teardownScript | `teardownScript` | `teardownScriptDesc` |

**Footer:** Cancel + Save (Spinner when pending).

### 14.5 ProjectTemplatesEditor (`components/ProjectTemplatesEditor.tsx`)

| Element | i18n |
|---------|------|
| Section title | `projectTerminalTemplates` |
| Description | `projectTerminalTemplatesDescription` |
| Add button | `addTerminalTemplate` |
| Empty | `noTerminalTemplates` |
| Row actions | edit (`editTerminalTemplate`), delete (`deleteTerminalTemplate`) |
| Row shows | name, command preview (mono), optional cwd |

**Sub-dialog:** `TerminalTemplateDraftDialog` (from terminal feature) for create/edit.

### 14.6 UnsavedFileCloseDialog

See §8.8.

---

## 15. Dialogs — Profiles

### 15.1 CreateProfileDialog

**Open triggers:**

- `ProfileList` "New Profile" control.
- `ProjectMenuItem` when project has only default profile.

| Element | i18n |
|---------|------|
| Title | GitBranchIcon + `createProfile` ("New Profile") |
| Field | `branchName`, placeholder `branchNamePlaceholder` |
| Footer | `cancel`, `create` |

**Enter:** submits if not pending.

**Success:** navigate to new profile route.

### 15.2 DeleteProfileDialog

**Open trigger:** Profile item context menu (`ProfileItem`).

| Element | i18n |
|---------|------|
| Title | TrashIcon + `deleteProfile` |
| Body | `confirmDeleteProfile` |
| Checking state | Spinner + `deleteProfileCheckingGitStatus` |
| Risk alert | `deleteProfileGitWarningTitle` + combined warnings |
| Git check failed alert | `deleteProfileGitCheckFailedTitle/Description` |
| Delete button | `deleteProfileAnyway` if risk, else `delete` |

**Delete disabled while:** git check fetching or delete pending.

---

## 16. Shared components

### 16.1 FileTreeFileIcon

- SVG icon from `@pierre/trees` symbol set based on filename extension.
- Default size **14px** (command palette uses **16**).
- Props: `fileName`, optional `size`.
- `aria-hidden="true"`, `data-icon-name`, `data-icon-token`.
- Color via CSS var `--trees-file-icon-color-{token}`.

### 16.2 OverflowTooltipText

- Truncating span (`min-w-0 truncate`).
- Tooltip only when text overflows (canvas measurement via `@chenglou/pretext`).
- Tooltip: side top, align start, max-width `min(480px, calc(100vw - 32px))`, `break-all whitespace-normal`.
- Prop `tooltipDisabled` suppresses tooltip.

**Used in:** sidebar profile labels (not in scoped file list but referenced by layout).

---

## 17. Terminal tab strip extras (`TerminalTemplateMenu`)

**New terminal tab trigger:** TabsTrigger value `__new-terminal__`, PlusIcon.

**Dropdown sections:** Project templates, global templates, default terminal; empty hint `noTemplatesDropdownHint`.

---

## 18. Complete keyboard shortcut reference (scoped surfaces)

| Shortcut | Surface | Action |
|----------|---------|--------|
| Cmd/Ctrl+K | Profile (active) | Open command palette |
| Cmd/Ctrl+S | File editor / markdown file | Save file |
| Cmd/Ctrl+G | Profile (active) | Open git diff dialog |
| Cmd/Ctrl+E | Profile (active) | Toggle sidebar open/close |
| Cmd/Ctrl+T | Profile (active) | New terminal |
| Cmd/Ctrl+W | Profile (active) | Close terminal tab |
| Arrow L/R, Home, End | Profile sidebar resize handle | Adjust width |
| Enter | Command palette | Open file |
| Escape | Command palette / dialogs | Close |
| Enter | Rename/create dialogs | Submit where wired |

---

## 19. i18n key index (English) — scoped features

Keys listed in `messages/en.json` directly referenced by inventoried components:

**Home:** `home`, `emptyProjectsTitle`, `emptyProjectsDesc`, `onboardingTourTitle`, `onboardingTourDesc`

**Project detail / terminal empty:** `noTerminalsOpen`, `noTerminalsOpenDescription`, `newTerminal`

**Sidebar:** `sidebarFilesTab`, `sidebarGitTab`, `notes`, `profileSidebarResizeSeparator`, `expandSidebar`

**File tree menus:** `fileTreeContextMenuOpen`, `fileTreeContextMenuOpenInDefaultApp`, `fileTreeContextMenuRevealInFileManager`, `fileTreeContextMenuRefresh`, `fileTreeContextMenuNewFile`, `fileTreeContextMenuNewFolder`, `fileTreeContextMenuCopyRelativePath`, `fileTreeContextMenuCopyAbsolutePath`, `rename`, `delete`, `fileTreeCreateErrorTitle`, `fileTreeDeleteErrorTitle`, `somethingWentWrong`

**Command palette:** `commandPaletteTitle`, `commandPalettePlaceholder`, `commandPaletteEmpty`, `commandPaletteNoResults`, `commandPaletteRoot`

**File close:** `closeUnsavedFileTitle`, `closeUnsavedFileDescription`, `cancel`, `discardChanges`

**Notes / markdown:** `notes`, `notesPlaceholder`, `notesSaving`, `notesSaved`, `notesSaveFailedShort`, `notesSaveFailedTitle`, all `notesFormat*`, `notesInsert*`, `notesTable*`, `notesCodeBlock*`, `notesCommandMenu`, `notesApplyLink`, `notesRemoveLink`, `preview`

**Project dialogs:** `createProject`, `chooseFolder`, `folder`, `projectName`, `projectNamePlaceholderFolder`, `createProjectChooseFolderHint`, `createProjectHintFolderEmpty`, `createProjectHintFolderNamed`, `create`, `cancel`, `deleteProject`, `confirmDeleteProject`, `renameProject`, `newName`, `rename`, `projectSettings`, `scripts`, `templates`, `projectWorktreeDir*`, `initScript*`, `setupScript*`, `teardownScript*`, `scriptPlaceholder`, `save`, `projectTerminalTemplates*`, `addTerminalTemplate`, `editTerminalTemplate`, `deleteTerminalTemplate`, `noTerminalTemplates`, `terminalTemplate`

**Profile dialogs:** `createProfile`, `branchName`, `branchNamePlaceholder`, `deleteProfile`, `confirmDeleteProfile`, `deleteProfileCheckingGitStatus`, `deleteProfileGitWarningTitle`, `deleteProfileLocalChangesWarning`, `deleteProfileUnpushedCommitsWarning`, `deleteProfileTotalDiffWarning`, `deleteProfileGitCheckFailedTitle`, `deleteProfileGitCheckFailedDescription`, `deleteProfileAnyway`

**Top bar:** `projectSettings`, `switchBranchTitle`, `topbarGithubDesktop`, `topbarEditor`, `topbarTerminal`, `topbarPrStatus`, `topbarPr*`, `topbarPreview`, `topbarAvailable`, `topbarDragHint`, `topbarResetDefaults`, `topbarDetectingApps`, `topbarNoControls`, `topbarAllControlsActive`, `topbarEditorApp`, `topbarTerminalApp`

**Git sidebar:** `noChangesDetected`, `changedFiles`, `gitCommitIncludeAll`, `gitOpenDiffView`, (+ commit composer keys)

---

## 20. Dialog open trigger summary

| Dialog | Trigger location |
|--------|------------------|
| CreateProjectDialog | AppSidebar new project button |
| DeleteProjectDialog | ProjectMenuItem context menu |
| RenameProjectDialog | ProjectMenuItem context menu |
| ProjectSettingsDialog | ProjectMenuItem context menu; ProjectTopBar gear |
| CreateProfileDialog | ProfileList; ProjectMenuItem (single-profile projects) |
| DeleteProfileDialog | ProfileItem context menu |
| UnsavedFileCloseDialog | Close dirty file tab in TerminalTabs |
| CommandPalette | Cmd/Ctrl+K |
| GitDiffDialog | Cmd/Ctrl+G; git sidebar maximize; double-click changed file |
| SwitchBranchDialog | Click branch in ProjectTopBar |

---

*Generated from codebase exploration. Hardcoded English strings not in en.json are called out explicitly (e.g. "Preview unavailable", archive file counts, "Choose template", draft "New File"/"New Folder").*
