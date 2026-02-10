## Why

The app currently has no dark mode support — it renders in Carbon's default light theme only. Dark mode is a baseline UX expectation for desktop apps (especially developer tools), reduces eye strain in low-light environments, and respects the user's OS-level appearance preference.

## What Changes

- Detect the OS color scheme preference (light/dark) and apply the matching Carbon theme automatically on launch
- Allow the user to override the OS default via a theme selector in Settings (options: System / Light / Dark)
- Persist the user's theme preference across sessions
- Ensure Tailwind utility colors and custom styles (TitleBar, sidebar overrides) adapt correctly to the active theme

## Capabilities

### New Capabilities
- `theme-switching`: OS-aware theme detection, manual override (System/Light/Dark), persistence, and runtime switching of Carbon + Tailwind color tokens

### Modified Capabilities

_(none — existing specs cover backend CRUD/PTY concerns and are unaffected by a frontend-only theming change)_

## Impact

- **Frontend CSS**: `app.css` gains Tailwind v4 dark variant config; `styles.scss` may need Carbon theme token imports (`@carbon/react/scss/themes`)
- **Components**: TitleBar's hardcoded `bg-[var(--cds-layer)]` and inline hex colors need dark-aware alternatives; AppSidebar inherits Carbon theme automatically
- **Settings page**: New theme selector UI (Carbon `<Select>` component, already used on that page)
- **State/persistence**: Small amount of local storage or Tauri store for the preference
- **No backend changes** — purely frontend
