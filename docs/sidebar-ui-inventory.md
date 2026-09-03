# 2code Sidebar / Left-Nav UI Inventory

Framework-agnostic inventory of every visual and interactive element in the app’s left navigation surfaces. Derived exclusively from source files listed in the exploration scope; nothing below is inferred beyond what the code defines.

**Scope:** Primary app sidebar (`AppSidebar`), profile secondary sidebar (`ProfileSidebar`), related primitives, loading/error fallbacks, window chrome that affects sidebar layout, and the top-bar mode switch that controls the profile sidebar.

**Last audited against:** `src/layout/*`, `src/features/projects/ProfileSidebar.tsx`, `src/features/projects/SidebarModeSwitch.tsx`, `src/features/git/components/SidebarGitPanel.tsx`, `src/components/ui/sidebar.tsx`, and supporting shared components.

---

## 1. Application layout context

```
App (flex h-full flex-col)
└── div (flex min-h-0 flex-1)                    ← horizontal split
    ├── AsyncBoundary
    │   └── AppSidebar OR SidebarSkeleton OR SidebarError
    └── main (relative flex-1 overflow-y-auto bg-card)
        ├── Routes (HomePage, ProjectDetailPage, …)
        └── TerminalLayer (persistent overlay)

ProjectDetailPage → ProfileLayout
└── div (flex h-full flex-col)
    ├── CommandPalette
    ├── div.border-b → ProjectTopBar (contains SidebarModeSwitch + expand-sidebar when collapsed)
    └── div (flex min-h-0 min-w-0 flex-1)
        ├── ProfileSidebar (files | git | notes)
        └── div.min-h-0.flex-1 → main content (terminals, file viewer, …)

Windows only: WindowControls (fixed top-right, h-7)
```

When `useAppSidebarStore.isCollapsed === true`, `AppSidebar` renders **nothing** (`return null`). The expand control appears in `ProjectTopBar` (project routes only), not on `HomePage`.

---

## 2. Design tokens and numeric constants

### 2.1 App sidebar width (`sidebarStore.ts`)

| Constant | Value | Usage |
|----------|-------|--------|
| `APP_SIDEBAR_MIN_WIDTH` | **220** px | Resize separator `aria-valuemin`, clamp |
| `APP_SIDEBAR_MAX_WIDTH` | **420** px | Resize separator `aria-valuemax`, clamp |
| `APP_SIDEBAR_DEFAULT_WIDTH` | **250** px | Initial persisted width |
| Resize keyboard step | **16** px | `useHorizontalResize` default `step` |

CSS variable `--sidebar-width` is set on:
- `SidebarProvider` inline style in `AppSidebar`
- `document.documentElement` via `sidebarStore` subscribe/sync

Default in `app.css`: `--sidebar-width: 250px`

### 2.2 Profile sidebar panel width (`ProfileSidebar.tsx`)

| Constant | Value |
|----------|-------|
| `SIDEBAR_PANEL_MIN_WIDTH` | **180** px |
| `SIDEBAR_PANEL_MAX_WIDTH` | **560** px |
| `DEFAULT_SIDEBAR_PANEL_WIDTH` | **208** px |
| localStorage key | `"file-tree-panel"` |
| Resize keyboard step | **16** px |

### 2.3 shadcn sidebar primitives (`sidebar.tsx`) — used but partially overridden

| Token | Value | Notes |
|-------|-------|-------|
| `SIDEBAR_WIDTH` | `16rem` (**256** px at 16px root) | Overridden by AppSidebar dynamic px |
| `SIDEBAR_WIDTH_MOBILE` | `18rem` (**288** px) | Not used: AppSidebar sets `collapsible="none"` |
| `SIDEBAR_WIDTH_ICON` | `3rem` (**48** px) | Not used in AppSidebar |
| `SIDEBAR_KEYBOARD_SHORTCUT` | `"b"` | Cmd/Ctrl+B in `SidebarProvider` — AppSidebar does not use shadcn collapse |

### 2.4 Sidebar color tokens (`app.css`)

Light `:root`:
- `--sidebar`: oklch(0.985 0 0)
- `--sidebar-foreground`: oklch(0.145 0 0)
- `--sidebar-accent`: oklch(0.97 0 0)
- `--sidebar-accent-foreground`: oklch(0.205 0 0)
- `--sidebar-border`: oklch(0.922 0 0)
- `--sidebar-ring`: oklch(0.708 0 0)

Dark `.dark` overrides exist for the same keys.

### 2.5 Tailwind size reference (used in sidebar UI)

| Class | Computed (16px root) |
|-------|----------------------|
| `size-4` / `[&_svg]:size-4` | 16×16 px |
| `size-3.5` | 14×14 px |
| `size-2` | 8×8 px (agent dot) |
| `size-6` | 24×24 px (maximize button) |
| `h-7` | 28 px |
| `h-8` | 32 px |
| `h-12` | 48 px (header brand button) |
| `w-5` / `min-w-5` / `h-5` | 20 px (badges, group actions) |
| `w-2` | 8 px (resize hit area) |
| `w-[250px]` | 250 px (skeleton/error fallback) |
| `pt-8` | 32 px (macOS header) |
| `pt-2` | 8 px (non-macOS header) |
| `p-2` | 8 px (header/footer/group padding) |
| `px-2` / `py-1.5` | horizontal 8 / vertical 6 px |
| `mx-3` | horizontal margin 12 px |
| `pl-4` | padding-left 16 px (reorder nested projects) |
| `right-9` | right offset 36 px (edit-order action) |
| `right-[-4px]` | extends resize handle 4 px past edge |
| `text-xs` | 12 px font |
| `text-sm` | 14 px font |
| `text-[0.625rem]` | 10 px (avatar fallback letter) |
| `rounded-md` | `--radius` related (~10 px with 0.625rem radius) |

---

## 3. Shared UI primitives (`components/ui/sidebar.tsx`)

App sidebar composes these building blocks. `AppSidebar` passes `collapsible="none"`, so only the **non-collapsible** code path runs (fixed-width column, no Sheet/mobile/offcanvas).

### 3.1 `SidebarProvider`

- Wrapper: `div.group/sidebar-wrapper.flex.min-h-svh.w-full`
- Merges CSS vars: `--sidebar-width`, `--sidebar-width-icon`
- AppSidebar adds: `className="h-full min-h-0 w-auto shrink-0"` and inline `--sidebar-width: ${sidebarWidth}px`

### 3.2 `Sidebar` (collapsible="none" branch)

- `div[data-slot=sidebar]`
- Classes: `flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground` + AppSidebar: `relative min-h-0 shrink-0 border-r`
- AppSidebar adds: `role="navigation"`, `aria-label={m.sideNavLabel()}`, `onKeyDown={handleKeyDown}`

### 3.3 `SidebarHeader`

- `div[data-slot=sidebar-header]`
- Default: `flex flex-col gap-2 p-2`
- AppSidebar: `shrink-0`, `data-tauri-drag-region`, platform padding (see §10)

### 3.4 `SidebarContent`

- `div[data-slot=sidebar-content]`
- Default: `no-scrollbar flex min-h-0 flex-1 flex-col gap-0 overflow-auto …`
- AppSidebar: `overflow-x-hidden [scrollbar-gutter:stable]`

### 3.5 `SidebarFooter`

- `div[data-slot=sidebar-footer]`
- Default: `flex flex-col gap-2 p-2`
- AppSidebar: `shrink-0`

### 3.6 `SidebarGroup`

- `div[data-slot=sidebar-group]`
- `relative flex w-full min-w-0 flex-col p-2`

### 3.7 `SidebarGroupLabel`

- `div` with: `flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 …`
- Contains section title text + optional `SidebarGroupAction` buttons (absolutely positioned)

### 3.8 `SidebarGroupAction`

- Button: `absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 … [&>svg]:size-4`
- Reorder-mode “done” variant adds: `right-9 bg-sidebar-accent text-sidebar-accent-foreground`
- Normal edit-order: `right-9` only on pencil button; plus button at default `right-3`

### 3.9 `SidebarGroupContent`

- `div`: `w-full text-sm`

### 3.10 `SidebarMenu` / `SidebarMenuItem`

- Menu: `ul.flex.w-full.min-w-0.flex-col.gap-0`
- Item: `li.group/menu-item.relative`

### 3.11 `SidebarMenuButton` (variants)

Base (`sidebarMenuButtonVariants`):
- `peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm …`
- `group-has-data-[sidebar=menu-action]/menu-item:pr-8` — reserves space for trailing action
- `[&_svg]:size-4 [&_svg]:shrink-0`
- `[&>span:last-child]:truncate`
- **Hover:** `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`
- **Active:** `data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground`
- **Focus:** `focus-visible:ring-2` on `ring-sidebar-ring`

Sizes:
- `default`: `h-8 text-sm`
- `sm`: `h-7 text-xs`
- `lg`: `h-12 text-sm` (header brand)

### 3.12 `SidebarMenuAction`

- `absolute top-1.5 right-1 flex aspect-square w-5 … [&>svg]:size-4`
- **Hover:** `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground`
- `showOnHover` mode (not used in AppSidebar project items): opacity 0 until group hover

### 3.13 `SidebarMenuBadge`

- `absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums`
- Used for project-group project counts

### 3.14 `SidebarMenuSub`

- Default: `ul.mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5`
- `ProjectGroupSection` override: `mx-0 translate-x-0 gap-0 border-l-0 px-0 py-0`

### 3.15 `SidebarMenuSubItem`

- `li.group/menu-sub-item.relative`

### 3.16 `SidebarMenuSubButton`

- `flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sm …`
- `[&>svg]:size-4`, active/hover same accent pattern as menu button

---

## 4. Primary app sidebar — `AppSidebar.tsx`

### 4.1 Visibility and collapse

- **Fully hidden** when `isCollapsed === true` (entire component returns `null`).
- Collapse toggle: header `SidebarMenuAction` with `SidebarSimpleIcon`, `aria-label={m.collapseSidebar()}`, `aria-expanded={true}`, `onClick={toggleCollapsed}`.
- Persisted in localStorage key `"app-sidebar-width"` (partialized: `width`, `isCollapsed`, `collapsedProjectGroupIds`; `isReorderMode` is **not** persisted).

### 4.2 Component tree (normal mode, projects exist)

```
AppSidebar
├── SidebarProvider (--sidebar-width: Npx)
│   └── Sidebar [role=navigation, aria-label=sideNavLabel]
│       ├── LayoutGroup id="app-sidebar"
│       │   ├── SidebarHeader [data-tauri-drag-region]
│       │   │   └── SidebarMenu
│       │   │       └── SidebarMenuItem
│       │   │           ├── SidebarMenuButton size=lg pointer-events-none
│       │   │           │   └── span.font-semibold → "2Code"
│       │   │           └── SidebarMenuAction → SidebarSimpleIcon (collapse)
│       │   ├── SidebarContent
│       │   │   ├── [optional] SidebarGroup "Pinned"
│       │   │   │   ├── SidebarGroupLabel → pinnedProjects
│       │   │   │   └── SidebarGroupContent → SidebarMenu
│       │   │   │       └── ProjectMenuItem × N
│       │   │   └── SidebarGroup "Projects"
│       │   │       ├── SidebarGroupLabel
│       │   │       │   ├── span → sidebarProjectsSection
│       │   │       │   ├── SidebarGroupAction → PencilSimpleLineIcon (edit order)
│       │   │       │   └── SidebarGroupAction id=add-project-button → PlusIcon
│       │   │       └── SidebarGroupContent → SidebarMenu
│       │   │           ├── ProjectGroupSection × groups
│       │   │           └── ProjectMenuItem × top-level projects
│       │   └── SidebarFooter
│       │       └── SidebarMenu
│       │           └── SidebarMenuItem
│       │               └── SidebarMenuButton → GearSixIcon + settings
│       └── div[role=separator] (width resize handle)
└── CreateProjectDialog
```

### 4.3 Header row

| Element | Content | Layout / classes | Interaction |
|---------|---------|------------------|-------------|
| Brand button | Text **"2Code"** (hardcoded, not i18n) | `SidebarMenuButton size="lg" className="pointer-events-none"`, inner `span.font-semibold` | Non-interactive (`pointer-events-none`) |
| Collapse action | `SidebarSimpleIcon` weight `regular` | `SidebarMenuAction`, default action positioning | Click → `toggleCollapsed`; a11y: `collapseSidebar` |

Both sit in one `SidebarMenuItem`. Menu button height **48 px** (`lg`).

### 4.4 Empty projects state

When `projects.length === 0`:

```
SidebarGroup
└── SidebarGroupContent
    └── SidebarMenu
        └── SidebarLink to="/" icon=HouseIcon → home
```

No pinned/projects sections, no footer change (footer still shows Settings).

### 4.5 Pinned projects section

**Visible when:** `sidebarLayout.pinnedProjects.length > 0` (normal mode).

| Element | Content |
|---------|---------|
| `SidebarGroupLabel` | `m.pinnedProjects()` → **"Pinned"** |
| Rows | `ProjectMenuItem` per pinned project |

### 4.6 Projects section (normal mode)

| Element | Content | a11y |
|---------|---------|------|
| Label text | `m.sidebarProjectsSection()` → **"Projects"** | — |
| Edit order | `PencilSimpleLineIcon`, `className="right-9"` | `aria-label={editProjectOrder}`, `aria-pressed={isReorderMode}`, `disabled={isSidebarLayoutSaving}` |
| New project | `PlusIcon`, `id="add-project-button"` | `aria-label={newProject}` → **"New Project"** |
| Body | `ProjectGroupSection` or `ProjectMenuItem` per `topEntries` | — |

**Dialog launched:** `CreateProjectDialog` via plus button.

### 4.7 Reorder mode (`isReorderMode === true`)

Replaces normal pinned/projects rendering with drag-and-drop UI.

#### 4.7.1 Pinned group (reorder)

- Label: **"Pinned"**
- `DndContext` + `SortableContext` + `SortableProjectRow` per pinned project
- Trailing `SidebarDropZone` id=`sidebar-drop:pinned`, label `dropHereToPin`, `compact` when pinned list non-empty

#### 4.7.2 Projects group (reorder)

- Label row: **"Projects"** + **CheckIcon** action (`doneEditingProjectOrder`, `className="right-9 bg-sidebar-accent text-sidebar-accent-foreground"`) + **PlusIcon** (new project)
- Top-level sortable entries:
  - **Group:** `SortableGroupRow` with nested `SidebarMenu className="pl-4"` containing nested `SortableProjectRow` + group drop zone
  - **Project:** `SortableProjectRow`
- Bottom `SidebarDropZone` id=`sidebar-drop:top-level`, label `dropHereToUnpinOrMoveOut`

#### 4.7.3 `SortableProjectRow`

```
SidebarMenuItem [opacity 0.45 when dragging]
├── SidebarMenuButton [data-sidebar-item, bg-sidebar-accent when dragging]
│   ├── span [cursor-grab] → DotsSixVerticalIcon (muted)
│   ├── ProjectAvatar
│   └── span → project.name
└── SidebarMenuAction
    ├── aria-label: pinProject | unpinProject
    ├── aria-pressed={isPinned}
    └── StarIcon
```

- Drag activation: `PointerSensor` distance **5** px
- Pin toggle calls `handleTogglePinned` (disabled while save in flight)

#### 4.7.4 `SortableGroupRow`

Same drag handle + `FolderIcon` + group name; `SidebarMenuBadge` shows `{projects.length}`; children = nested project list + drop zone.

#### 4.7.5 `SidebarDropZone`

- Container: `mx-3 rounded-md border border-dashed px-3 text-center text-xs text-muted-foreground`
- Spacing: `compact ? "my-1 py-1" : "my-2 py-2"`
- **isOver:** `border-foreground/30 bg-muted`; else `border-border`

### 4.8 Footer — Settings

| Element | Icon | Label | Action |
|---------|------|-------|--------|
| `SidebarMenuButton` | `GearSixIcon` | `m.settings()` → **"Settings"** | `openSettingsWindow()` (separate Tauri window) |
| Attribute | `data-sidebar-item` | — | Included in arrow-key nav |

### 4.9 Width resize separator

```
div[role=separator]
  aria-label="Resize sidebar"          ← hardcoded English, not i18n
  aria-orientation="vertical"
  aria-valuemin=220 aria-valuemax=420 aria-valuenow={sidebarWidth}
  tabIndex=0
  className:
    absolute top-0 right-[-4px] bottom-0 w-2 cursor-col-resize
    before: absolute vertical 1px line at center
    hover:before:bg-border
    focus-visible:outline-2 outline-offset-[-2px] outline-(--app-focus-ring)
    dragging: before:bg-foreground/30
```

Keyboard on separator: ArrowLeft/Right ±16 px, Home=min, End=max.

### 4.10 Keyboard navigation (`handleKeyDown` on `Sidebar`)

- **ArrowDown / ArrowUp:** Cycle focus among `[data-sidebar-item]` elements inside sidebar ref.
- Does not wrap parent containers; flat query of all items in DOM order (includes nested profile rows when expanded).

### 4.11 Global shortcuts affecting sidebar (from `App.tsx`)

| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+, | `openSettingsWindow()` (same as footer) |
| Cmd/Ctrl+Shift+D | Debug panel (unrelated) |

### 4.12 Error toast

Failed layout persist: `toast.error(sidebarOrderUpdateFailed)` with error message description.

---

## 5. `ProjectMenuItem.tsx`

One row per project in the app sidebar (normal mode).

### 5.1 Tree

```
SidebarMenuItem.group/project-item
├── ContextMenu
│   ├── ContextMenuTrigger → SidebarMenuButton → NavLink
│   │   ├── ProjectAvatar
│   │   └── span.min-w-0.flex-1.truncate.font-medium → project.name
│   └── ContextMenuContent
│       ├── ProjectGroupMenu (submenu)
│       ├── projectSettings
│       ├── renameProject
│       ├── [separator]
│       └── deleteProject (destructive)
├── [branch A] hasOnlyDefaultProfile
│   └── Tooltip → SidebarMenuAction (create profile)
│       ├── PlusIcon (hidden until group-hover/group-focus-within)
│       └── AgentStatusDot (hidden on hover/focus-within when indicator present)
├── [branch B] multiple profiles
│   └── SidebarMenuAction (expand/collapse)
│       └── CaretDownIcon | CaretRightIcon
└── [if expanded && !hasOnlyDefaultProfile]
    └── SidebarMenuSub
        ├── SidebarMenuSubItem → default profile row
        ├── ProfileList (non-default profiles)
        └── (CreateProfileDialog only in branch A on action)
```

### 5.2 Project row button

- **Link target:** `/projects/{id}/profiles/{defaultProfileId}` or `/projects/{id}` if no default profile
- **Attributes:** `data-project-id`, `data-testid="project-sidebar-item"`, `data-sidebar-item`
- **Active when:** `hasOnlyDefaultProfile && activeProfileId === defaultProfile.id`
- **Text:** `project.name`, truncated, `font-medium`

### 5.3 Trailing action — single-profile projects

When `nonDefaultProfiles.length === 0`:

| State | Visible control |
|-------|-----------------|
| Default | `AgentStatusDot` if agent status/completion exists |
| `:hover` / `:focus-within` on `.group/project-item` | `PlusIcon` (`hidden group-hover/project-item:block group-focus-within/project-item:block`) |

- **Tooltip:** side `right`, text `createProfile` → **"New Profile"**
- **aria-label:** `createProfile`
- Click/Enter/Space → `CreateProfileDialog`

Agent indicator source: `useProfileAgentStatus(defaultProfileId) ?? useProfileAgentCompletion(defaultProfileId)`.

### 5.4 Trailing action — multi-profile projects

- **Icon:** `CaretDownIcon` (expanded) or `CaretRightIcon` (collapsed)
- **aria-label:** `toggleProjectGroup({ name: project.name })` → **"Toggle project group {name}"**
- **aria-expanded:** `expanded` (default expanded: `userExpanded ?? true`)
- Click toggles local `userExpanded` state

### 5.5 Default profile sub-row (multi-profile only)

```
SidebarMenuSubButton → NavLink(defaultProfileUrl)
├── TerminalWindowIcon
├── OverflowTooltipText(displayValue=defaultProfile, tooltipValue=defaultProfile)
└── AgentStatusDot (if indicator)
```

- **Label i18n:** `defaultProfile` → **"Default"**
- **Active when:** `activeProfileId === defaultProfile.id`

### 5.6 Context menu items

| Item | i18n key | English | Opens |
|------|----------|---------|-------|
| Submenu | `addToProjectGroup` | Add to Project Group | Inline submenu |
| | `projectSettings` | Project Settings | `ProjectSettingsDialog` |
| | `renameProject` | Rename | `RenameProjectDialog` |
| Separator | — | — | — |
| Destructive | `deleteProject` | Delete Project | `DeleteProjectDialog` |

---

## 6. `ProjectGroupSection.tsx`

Folder row grouping projects under a `ProjectGroup`.

### 6.1 Tree

```
SidebarMenuItem
├── SidebarMenuButton [type=button, data-sidebar-item]
│   ├── CaretRightIcon | CaretDownIcon
│   └── span → group.name
├── SidebarMenuBadge → projects.length
└── AnimatePresence
    └── motion.div (height/opacity animation, overflow hidden)
        └── SidebarMenuSub [mx-0 translate-x-0 gap-0 border-l-0 px-0 py-0]
            └── ProjectMenuItem × projects
```

### 6.2 Collapse state

- Stored in `useAppSidebarStore.collapsedProjectGroupIds` (persisted)
- `collapsed === true` → caret right, children not rendered
- **aria-expanded:** `!collapsed`
- **aria-label:** `toggleProjectGroup({ name: group.name })`
- Enter/Space on button toggles

### 6.3 Animation

- Duration **0.18** s, ease `[0.22, 1, 0.36, 1]`
- `prefers-reduced-motion`: no height/opacity animation (exit keeps opacity 1; enter skips initial)

---

## 7. `ProjectGroupMenu.tsx` (context submenu)

Rendered inside project context menu.

### 7.1 Structure

```
ContextMenuSub
├── ContextMenuSubTrigger → addToProjectGroup (truncated)
└── ContextMenuSubContent.min-w-56
    ├── [if no groups] div.px-3.py-2.text-sm.text-muted-foreground → noProjectGroups
    ├── [else] ContextMenuItem per group
    │   ├── CheckIcon (opacity-0 if not current)
    │   └── span.truncate → group.name
    ├── [if project in group] separator + removeFromProjectGroup (XIcon)
    ├── separator
    └── create flow OR createProjectGroup item
```

### 7.2 Create group inline input

When `isCreating || projectGroups.length === 0`:
- Wrapper: `px-2 py-1.5`
- `Input` placeholder `projectGroupNamePlaceholder` → **"e.g. Work"**
- **Enter:** submit create + assign
- **Escape:** cancel, clear name

### 7.3 Pending/disabled

- `disabled={isPending || isCurrent}` on group items
- Errors: toast `somethingWentWrong` + description

---

## 8. `ProjectAvatar.tsx`

| Setting | Behavior |
|---------|----------|
| `useSidebarSettingsStore.showProjectAvatars` | default **true**, persisted `"sidebar-settings"` |
| When false | Renders **null** (no placeholder gap in button — icon slot omitted) |
| When true | `span.grid.size-4.shrink-0.place-items-center.overflow-hidden.rounded-md.bg-sidebar-accent.text-sidebar-accent-foreground` |

**Image path:** `useProjectAvatar(projectId)` when enabled.

**Fallback:** first grapheme of trimmed `projectName` uppercased, or `"?"`; text `text-[0.625rem] leading-none font-medium` (**10 px**).

**Image:** `img.size-full.object-cover`, `alt={projectName}`, onError → fallback letter.

---

## 9. `ProfileList.tsx` + `ProfileItem.tsx`

### 9.1 ProfileList

Maps `profiles` (non-default only) to `ProfileItem`, then append:

```
SidebarMenuSubItem
└── SidebarMenuSubButton [button, data-sidebar-item]
    ├── PlusIcon weight=regular
    └── span → createProfile ("New Profile")
```

Opens `CreateProfileDialog` for `projectId`.

### 9.2 ProfileItem

```
SidebarMenuSubItem
├── ContextMenu
│   ├── ContextMenuTrigger → SidebarMenuSubButton → NavLink
│   │   ├── GitBranchIcon
│   │   ├── OverflowTooltipText(branch_name)
│   │   └── AgentStatusDot?
│   └── ContextMenuContent
│       └── deleteProfile (destructive)
└── DeleteProfileDialog
```

- **Route:** `/projects/{projectId}/profiles/{profile.id}`
- **Active:** `isActive` prop
- **Label:** `profile.branch_name` (not i18n — raw git branch name)

---

## 10. `AgentStatusDot.tsx`

| Property | Value |
|----------|-------|
| Size | `size-2` → **8×8 px** circle |
| `aria-hidden` | `true` (decorative) |
| `data-agent-status` | `waiting` \| `running` \| `completed` |

| Status | Visual |
|--------|--------|
| `waiting` | `bg-yellow-400` |
| `completed` | `bg-green-500` |
| `running` | `bg-emerald-400` + pulsing shadow; class `agent-status-dot--running` |

**Running animation** (`app.css`): `agent-status-pulse` 1.4s ease-in-out infinite; disabled under `prefers-reduced-motion`.

---

## 11. `SidebarLink.tsx`

Used only for Home link when no projects.

```
SidebarMenuItem
└── SidebarMenuButton → NavLink
    ├── {icon}
    └── span → {children}
```

- **Active:** `useMatch(pattern ?? to)`
- **`data-sidebar-item`:** yes

---

## 12. `OverflowTooltipText.tsx`

Used on profile branch names and default profile label.

- Display: `span.min-w-0.truncate` (+ passed `className`)
- Tooltip: only when measured text overflows (>0.5 px); side **top**, align **start**
- Tooltip content: `max-w-[min(480px,calc(100vw-32px))] break-all whitespace-normal`
- Prop `tooltipDisabled` suppresses tooltip (not used in sidebar profile rows)

---

## 13. Loading and error fallbacks — `Fallbacks.tsx`

### 13.1 `SidebarSkeleton`

```
aside.w-[250px].shrink-0.border-r.bg-muted/40.p-4
└── div.flex.flex-col.gap-3
    ├── Skeleton h-6 w-full
    ├── Skeleton mt-2 h-3 w-1/2
    └── Skeleton ml-5 h-5 w-3/4 × 3
```

Fixed width **250 px** (matches default sidebar width, not dynamic store width).

### 13.2 `SidebarError`

Same shell as skeleton (`w-[250px] … p-4`) with centered `ErrorStack`:
- Title: `somethingWentWrong` → **"Something went wrong"**
- Message: `error.message`
- Button: `tryAgain` → **"Try again"**

---

## 14. Profile sidebar — `ProfileSidebar.tsx`

Secondary left panel inside project view; not the app sidebar, but part of left-nav UX.

### 14.1 Placement

```
ProfileLayout
└── flex row
    ├── ProfileSidebar (this)
    └── main content
```

Controlled by `ProfileLayout` state: `fileTreeOpen` (default **true**), `sidebarMode` (`"files"` \| `"git"` \| `"notes"`).

### 14.2 Outer wrapper

```
div.h-full.shrink-0
  pointerEvents: isOpen ? auto : none
  aria-hidden: !isOpen
└── motion.div
    animate width: isOpen ? panelWidth : 0
    spring transition (stiffness 320, damping 34, mass 0.9) unless reduced motion or dragging
    className: relative flex h-full min-w-0 flex-col
    overflow: visible
```

### 14.3 Mode panels

| Mode | Visibility | Content wrapper |
|------|------------|-----------------|
| `files` | `display: block/none` on wrapper | `FileTreePanel` |
| `git` | conditional render | `SidebarPanelContent` → `SidebarGitPanel` |
| `notes` | conditional render | `SidebarPanelContent` → `ProfileNotesEditor` |

`SidebarPanelContent`: `div.flex.min-h-0.min-w-0.flex-1.flex-col.overflow-hidden.border-r` + `AsyncBoundary` (spinner / error).

**Files tree stays mounted** when switching modes (`display:none` when not files).

### 14.4 Resize separator (profile panel)

```
div[role=separator]
  aria-label=profileSidebarResizeSeparator → "Resize sidebar"
  aria-valuemin=180 aria-valuemax=560 aria-valuenow={panelWidth}
  className: absolute top-0 -right-1 bottom-0 z-[1] w-2 cursor-col-resize
             focus-visible:outline-2 -outline-offset-2 outline-[var(--app-focus-ring)]
```

Same keyboard resize behavior as app sidebar (±16 px, Home/End).

---

## 15. `SidebarModeSwitch.tsx` (top bar control for profile sidebar)

Located in `ProjectTopBar` left cluster — controls profile sidebar mode, not app sidebar.

### 15.1 Structure

```
Tabs value={isOpen ? mode : null}
└── TabsList.h-7
    └── ×3 Tooltip
        └── TabsTrigger.px-2 aria-label={label()}
            ├── Icon className=size-3.5 (14px)
            └── [git only] +{additions} text-green-500, -{deletions} text-red-500
```

### 15.2 Tabs

| value | Icon | i18n | English |
|-------|------|------|---------|
| `files` | `FolderSimpleIcon` | `sidebarFilesTab` | Files |
| `git` | `GitBranchIcon` | `sidebarGitTab` | Git |
| `notes` | `NoteIcon` | `notes` | Notes |

**Git badge:** `useGitDiffStats(profileId, isActive)` when tab is git; shows `+N` / `-M` in `text-xs`.

**Behavior (ProfileLayout):** Re-clicking active mode while open closes sidebar; switching mode opens sidebar.

### 15.3 TabsList / TabsTrigger styling (from `tabs.tsx`)

- List: `inline-flex … rounded-lg p-[3px] bg-muted`, height overridden to **28 px** (`h-7`)
- Trigger: `text-sm`, active gets `data-active:bg-background` + shadow

---

## 16. Profile sidebar — Files mode (`FileTreePanel.tsx`)

### 16.1 Container

```
div.flex.h-full.min-h-0.min-w-0.overflow-hidden
└── motion.div (opacity/x slide when isOpen)
    └── div.relative.min-h-0.min-w-0.flex-1.border-r.px-1.5.py-1
        ├── FileTree (@pierre/trees) + context menus
        ├── FileTreeRootContextMenu (positioned)
        └── [error overlay] absolute inset-0 centered text-xs muted
```

### 16.2 File tree visual tokens (`FILE_TREE_HOST_STYLE`)

| CSS variable override | Value |
|-----------------------|-------|
| `--trees-font-size-override` | **13px** |
| `--trees-border-radius-override` | **4px** |
| `--trees-level-gap-override` | **12px** |
| `--trees-item-margin-x-override` | **4px** |
| `--trees-item-padding-x-override` | **4px** |
| `--trees-padding-inline-override` | **4px** |
| Colors | map to `--muted`, `--muted-foreground`, `--foreground` |

Density: `"compact"`, icons: `"complete"`, initial expansion: `"closed"`.

### 16.3 Animation

- Opacity 0→1, x -12→0 when opening; duration **0.18** s (same easing as project group)

### 16.4 Context menus (sidebar-relevant)

**Root menu items (i18n keys):** `fileTreeContextMenuNewFile`, `NewFolder`, `Refresh`, `RevealInFileManager`, `CopyRelativePath`, `CopyAbsolutePath`

**Item menu adds:** Open, OpenInDefaultApp, Rename, Delete, etc.

Popup: `min-w-40 rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10`

### 16.5 Error state

Absolute overlay, `pointer-events-none`, shows `getErrorMessage(treePathsError)` in `text-xs text-muted-foreground`.

---

## 17. Profile sidebar — Git mode (`SidebarGitPanel.tsx`)

Vertical stack:

```
div.flex.min-h-0.min-w-0.flex-1.flex-col.overflow-hidden
├── ChangesFileList (tooltipsDisabled, emptyMessage=noChangesDetected, onMaximize)
└── CommitComposer
```

Plus modal `GitDiffDialog` (not inline in panel).

### 17.1 ChangesFileList header (sticky)

```
div.sticky.top-0.z-[1].flex.items-center.gap-2.border-b.bg-background.px-3.py-2.5
├── Checkbox (include all/none) aria-label=gitCommitIncludeAll → "All"
├── p.text-xs.text-muted-foreground → changedFiles({ count })
└── [optional] Button size=xs ghost ml-auto size-6 → ArrowsOutSimpleIcon (gitOpenDiffView)
```

**Empty state:** centered `p-6`, `text-xs text-muted-foreground` → **"No changes detected"**

### 17.2 File row (`FileListItem`)

```
div.flex.w-full.items-start.gap-2.px-3.py-2
├── Checkbox.mt-0.5
├── OverflowTooltipText basename (text-sm, font-medium if active)
├── optional parent path (text-xs muted)
└── Badge size-4 (change type letter)
```

- **Active row:** `bg-muted`
- **Inactive hover:** `hover:bg-muted/70`
- **Excluded:** `opacity-70`
- **Double-click:** opens `GitDiffDialog` focused on file
- **Context menu:** discard action (`gitDiscardFileAction`)

Context menu width constant: **200** px.

### 17.3 CommitComposer footer

```
div.shrink-0.border-t.px-2.5.py-2
├── p.text-xs.font-medium.uppercase.text-muted-foreground → gitCommitSectionTitle ("Commit")
├── Field: gitCommitSummary + Input h-7 text-xs
├── Field: gitCommitBody + Textarea min-h-[4.5rem] text-xs
└── flex justify-end gap-2
    ├── [if no files] Push button (UploadSimpleIcon, optional ahead count)
    └── [else] Commit button (Spinner when pending)
```

**Commit shortcut:** Cmd/Ctrl+Enter when `canSubmit`.

---

## 18. Profile sidebar — Notes mode

`ProfileNotesEditor` → `MarkdownEditor` full flex area inside `SidebarPanelContent`.

| UI element | i18n |
|------------|------|
| Placeholder | `notesPlaceholder` |
| Save failed toast | `notesSaveFailedTitle` |
| Editor save status labels | `notesSaved`, `notesSaveFailedShort` (in MarkdownEditor) |

---

## 19. `WindowControls.tsx` (Windows platform)

Not part of sidebar column but affects top-bar padding when app sidebar collapsed.

```
div.fixed.top-0.right-0.flex.h-7 [data-window-controls]
├── Minimize (MinusIcon 12px) aria-label="Minimize"
├── Maximize/Restore (SquareIcon | CopySimpleIcon 12px)
└── Close (XIcon 12px) aria-label="Close"
```

| Button | Size | Hover |
|--------|------|-------|
| Minimize / Maximize | `h-7 w-9` (28×36 px) | `hover:bg-muted` |
| Close | same | `hover:bg-[#c42b1c] hover:text-white` |

`[-webkit-app-region:no-drag]` on buttons.

`ProjectTopBar` adds `pr-[118px]` on Windows to clear controls.

---

## 20. Platform differences

### 20.1 macOS

| Location | Adjustment |
|----------|------------|
| `AppSidebar` `SidebarHeader` | `pt-8` (**32 px**) — comment: clear traffic lights at y:26+12px |
| `ProjectTopBar` | When app sidebar collapsed: `pl-[84px]` to clear traffic lights |
| Window controls | Native overlay (not `WindowControls` component) |
| Header drag | `data-tauri-drag-region` on sidebar header + top bar |

### 20.2 Windows

| Location | Adjustment |
|----------|------------|
| `AppSidebar` header | `pt-2` (**8 px**) |
| `WindowControls` | Rendered fixed top-right |
| `ProjectTopBar` | `pr-[118px]` for custom window buttons |

### 20.3 Linux / other

Same as Windows for header padding (`pt-2`); no `WindowControls` unless Windows platform check passes.

---

## 21. Keyboard shortcuts summary (sidebar-related)

| Context | Shortcut | Action |
|---------|----------|--------|
| App | Cmd/Ctrl+, | Open settings window |
| App sidebar | ArrowUp/Down | Focus prev/next `[data-sidebar-item]` |
| App sidebar resize | ArrowLeft/Right | ±16 px width |
| App sidebar resize | Home / End | Min / max width |
| ProjectTopBar (active profile) | Cmd/Ctrl+E | Toggle profile sidebar open/closed |
| ProjectTopBar (active profile) | Cmd/Ctrl+G | Open git diff dialog (not sidebar panel) |
| Profile panel resize | ArrowLeft/Right, Home, End | Same as app sidebar |
| Commit composer | Cmd/Ctrl+Enter | Commit when valid |
| Project group menu input | Enter / Escape | Create / cancel |
| shadcn SidebarProvider | Cmd/Ctrl+B | Toggle shadcn sidebar — **not wired** for AppSidebar collapse |

---

## 22. Persisted client state

| Store | Key | Fields |
|-------|-----|--------|
| `useAppSidebarStore` | `app-sidebar-width` | `width`, `isCollapsed`, `collapsedProjectGroupIds` |
| `useSidebarSettingsStore` | `sidebar-settings` | `showProjectAvatars` (default true) |
| Profile panel width | `file-tree-panel` | `{ state: { panelWidth }, version: 2 }` |

---

## 23. Complete i18n key → English map (sidebar scope)

| Key | English text |
|-----|--------------|
| `home` | Home |
| `sideNavLabel` | Side navigation |
| `collapseSidebar` | Collapse sidebar |
| `expandSidebar` | Expand sidebar |
| `settings` | Settings |
| `pinnedProjects` | Pinned |
| `sidebarProjectsSection` | Projects |
| `editProjectOrder` | Edit project order |
| `doneEditingProjectOrder` | Done editing project order |
| `newProject` | New Project |
| `pinProject` | Pin project |
| `unpinProject` | Unpin project |
| `dropHereToPin` | Drop here to pin |
| `dropProjectIntoFolder` | Drop project into folder |
| `dropHereToUnpinOrMoveOut` | Drop here to unpin or move out |
| `sidebarOrderUpdateFailed` | Failed to update sidebar order |
| `toggleProjectGroup` | Toggle project group {name} |
| `defaultProfile` | Default |
| `createProfile` | New Profile |
| `projectSettings` | Project Settings |
| `renameProject` | Rename |
| `deleteProject` | Delete Project |
| `deleteProfile` | Delete Profile |
| `addToProjectGroup` | Add to Project Group |
| `noProjectGroups` | No project groups yet. |
| `removeFromProjectGroup` | Remove from Project Group |
| `projectGroupNamePlaceholder` | e.g. Work |
| `createProjectGroup` | Create Project Group |
| `somethingWentWrong` | Something went wrong |
| `tryAgain` | Try again |
| `sidebarFilesTab` | Files |
| `sidebarGitTab` | Git |
| `notes` | Notes |
| `profileSidebarResizeSeparator` | Resize sidebar |
| `noChangesDetected` | No changes detected |
| `changedFiles` | {count} changed file(s) |
| `gitOpenDiffView` | Open diff view |
| `gitCommitIncludeAll` | All |
| `gitCommitSectionTitle` | Commit |
| `gitCommitSummary` | Summary |
| `gitCommitSummaryPlaceholder` | Describe the changes you're committing |
| `gitCommitBody` | Description |
| `gitCommitBodyPlaceholder` | Add an optional extended description |
| `gitCommitButton` | Commit |
| `gitPushButton` | Push |
| `gitDiscardFileAction` | Discard changes to this file |
| `notesPlaceholder` | (see messages/en.json) |
| `notesSaveFailedTitle` | Notes save failed |

**Hardcoded non-i18n strings in sidebar UI:** `"2Code"` (brand), resize separator `aria-label="Resize sidebar"` on app sidebar, Windows control labels `"Minimize"`, `"Maximize"`, `"Restore"`, `"Close"`.

---

## 24. Dialogs and menus launched from sidebar surfaces

| Trigger location | UI | Component |
|------------------|-----|-----------|
| Projects `+` | New project | `CreateProjectDialog` |
| Project context menu | Settings / Rename / Delete | respective dialogs |
| Project context submenu | Group assign/create | inline + API |
| Single-profile `+` action | New profile | `CreateProfileDialog` |
| ProfileList footer | New profile | `CreateProfileDialog` |
| Profile context menu | Delete profile | `DeleteProfileDialog` |
| Settings footer | Settings | `openSettingsWindow()` |
| Git panel maximize | Full diff | `GitDiffDialog` |
| File tree context menus | File operations | `@pierre/trees` + dropdown items |

---

## 25. Interactive state matrix (app sidebar)

| State | Visual evidence in code |
|-------|-------------------------|
| Nav item hover | `SidebarMenuButton` / `SubButton` accent background |
| Nav item active/route | `data-active` / `isActive` → accent bg + medium font (project name) |
| Project row hover (single profile) | Swap agent dot ↔ plus icon |
| Reorder dragging | opacity **0.45**, optional `bg-sidebar-accent` on button |
| Drop zone hover | dashed border `border-foreground/30`, `bg-muted` |
| Reorder saving | actions `disabled={isSidebarLayoutSaving}` |
| Group collapsed | caret right, animated height 0 |
| Project expanded (multi) | caret down + `SidebarMenuSub` visible |
| Sidebar collapsed | entire `AppSidebar` unmounted |
| Loading projects | `SidebarSkeleton` 250 px |
| Load error | `SidebarError` with retry |

---

## 26. Data model driving layout (`sidebarLayout.ts`)

**Pinned:** projects with `pinned_order != null`, sorted by pinned_order.

**Top entries:** merge of `ProjectGroup` entries (with nested grouped projects) and ungrouped top-level projects; sorted by `sort_order` / `created_at`.

**Reorder persistence:** `createSidebarLayoutUpdates` emits sort orders in steps of **1000** (`SIDEBAR_ORDER_STEP`).

Drop zone IDs:
- `sidebar-drop:pinned`
- `sidebar-drop:top-level`
- `sidebar-drop:group:{groupId}`

Entry IDs: `project:{id}`, `group:{id}`.

---

## 27. Parent → child index (quick reference)

```
AppSidebar
├── Header: brand + collapse
├── Content
│   ├── [empty] Home link
│   ├── [normal] Pinned → ProjectMenuItem*
│   ├── [normal] Projects → ProjectGroupSection* | ProjectMenuItem*
│   └── [reorder] Pinned DnD + Projects DnD
├── Footer: Settings
└── Resize handle

ProjectMenuItem
├── Project row (avatar, name, context menu)
├── Action (plus+dot | caret)
└── Sub: Default row + ProfileList + dialogs

ProjectGroupSection
├── Group row (caret, name, badge)
└── Sub: ProjectMenuItem*

ProfileSidebar
├── FileTreePanel | SidebarGitPanel | ProfileNotesEditor
└── Resize handle

ProjectTopBar (when app sidebar collapsed)
└── Expand sidebar button (SidebarSimpleIcon)
```

This document is intended as the single source of truth for reimplementing the sidebar UI in a non-React/non-web stack while preserving layout, spacing, states, and behavior.
