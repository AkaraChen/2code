## Context

The app uses a **Tailwind CSS v4 + Carbon Design System** hybrid:

- Tailwind handles layout/spacing via `@tailwindcss/vite` (no separate config file; Tailwind v4 uses CSS-based config in `app.css`)
- Carbon provides UI components (`SideNav`, `Select`) and CSS custom properties (`--cds-layer`, etc.)
- SCSS (`styles.scss`) imports Carbon via `@use '@carbon/react'` and adds sidebar overrides
- TitleBar uses Carbon's `--cds-layer` token for its background and hardcoded hex for traffic light buttons

Carbon already ships a `GlobalTheme` provider and `usePrefersDarkScheme()` hook. Its four themes are: `white`, `g10` (light gray), `g90` (dark gray), `g100` (full dark). Wrapping the app in `<GlobalTheme theme="g100">` switches all Carbon CSS custom properties automatically — no manual token overrides needed.

Tailwind v4 supports `@variant dark (&:where([data-carbon-theme="g90"], [data-carbon-theme="g100"]) *)` to hook dark utilities to Carbon's theme attribute instead of a separate class or `prefers-color-scheme`.

## Goals / Non-Goals

**Goals:**

- OS-aware theme on first launch (via `usePrefersDarkScheme` / `prefers-color-scheme`)
- User-selectable override: System / Light / Dark in Settings page
- Preference persisted to `localStorage` (simple, no extra dependency)
- Carbon components and Tailwind utilities both respond to the active theme
- TitleBar adapts (background via Carbon token already works; traffic light hover text adapts)

**Non-Goals:**

- Per-page or per-component theme zones (Carbon's `<Theme>` supports this, but not needed now)
- Custom color palette or brand tokens beyond Carbon defaults
- Backend/Rust involvement (purely frontend)
- Animated theme transitions

## Decisions

### 1. Carbon theme pairing: `white` (light) ↔ `g100` (dark)

Use `white` for light mode and `g100` for dark mode. These are the highest-contrast pair in Carbon's palette. `g10`/`g90` could be used later for sub-regions via `<Theme>` if needed.

**Alternative considered**: `g10` / `g90` — lower contrast, more "muted" feel. Rejected because `white`/`g100` is the Carbon default and gives the clearest light/dark distinction.

### 2. Theme state: React context + `localStorage`

Create a `ThemeProvider` component that:

1. Reads stored preference from `localStorage` key `theme-preference` (values: `"system"`, `"light"`, `"dark"`, default `"system"`)
2. Calls `usePrefersDarkScheme()` from `@carbon/react` to detect OS preference when set to `"system"`
3. Resolves to the effective Carbon theme string (`"white"` or `"g100"`)
4. Wraps children in `<GlobalTheme theme={resolved}>`
5. Exposes `{ preference, setPreference }` via context for the Settings UI

**Alternative considered**: Tauri store plugin (`tauri-plugin-store`) — heavier dependency for a single string value. `localStorage` is sufficient and simpler.

### 3. Tailwind dark variant via Carbon's `data-carbon-theme` attribute

Tailwind v4 allows custom variants in CSS. Define a `dark` variant that matches Carbon's data attribute:

```css
@custom-variant dark (&:where([data-carbon-theme="g90"], [data-carbon-theme="g100"]) *);
```

This means `dark:bg-zinc-900` activates whenever Carbon is in a dark theme — zero JS coordination needed between the two systems.

**Alternative considered**: Separate `prefers-color-scheme` media query for Tailwind — would decouple Tailwind from Carbon's state, causing potential mismatches when the user overrides OS preference.

### 4. TitleBar adjustments

- Background already uses `bg-[var(--cds-layer)]` — this adapts automatically via `GlobalTheme`
- Traffic light buttons keep their hardcoded colors (red/yellow/green) — these are macOS-standard and should not change
- The hover text color (`group-hover:text-black/50`) needs a dark variant: `dark:group-hover:text-white/50`

### 5. Settings UI

Add a second `<Select>` to `SettingsPage` for theme (System / Light / Dark), placed below the existing language selector. Reuse the same Carbon `Select`/`SelectItem` components already imported.

## Risks / Trade-offs

- **Carbon SCSS import order**: `@use '@carbon/react'` in `styles.scss` loads the default (white) theme tokens. `GlobalTheme` overrides these at runtime via CSS custom properties on `[data-carbon-theme]`. This works because Carbon's components read custom properties, not SCSS variables, at render time. → No mitigation needed, this is the documented approach.
- **Flash of wrong theme on load**: `localStorage` is synchronous, so reading the preference before first render avoids flash. `usePrefersDarkScheme` uses `matchMedia` which is also synchronous. → Minimal risk.
- **Tailwind utility gaps**: Any Tailwind color utility used without a `dark:` counterpart will stay light-themed. → Audit existing Tailwind usage (currently minimal — mostly layout utilities, not color) during implementation.
