## 1. Tailwind Dark Variant

- [x] 1.1 Add `@custom-variant dark` rule to `src/app.css` that matches Carbon's `data-carbon-theme` attribute for `g90` and `g100`

## 2. ThemeProvider

- [x] 2.1 Create `src/components/ThemeProvider.tsx` with React context exposing `{ preference, setPreference }`
- [x] 2.2 Read initial preference from `localStorage` key `theme-preference` (default `"system"`)
- [x] 2.3 Use Carbon's `usePrefersDarkScheme()` to resolve `"system"` to `"white"` or `"g100"`
- [x] 2.4 Wrap children in `<GlobalTheme theme={resolvedTheme}>` from `@carbon/react`
- [x] 2.5 Persist preference to `localStorage` on change

## 3. App Integration

- [x] 3.1 Wrap `<App />` in `<ThemeProvider>` in `src/main.tsx`

## 4. TitleBar Adaptation

- [x] 4.1 Add `dark:group-hover:text-white/50` to traffic light button icon classes in `src/components/TitleBar.tsx`

## 5. Settings UI

- [x] 5.1 Add theme `<Select>` (System / Light / Dark) to `src/pages/SettingsPage.tsx` below the language selector
- [x] 5.2 Wire the selector to `useThemePreference()` context (read current value, call `setPreference` on change)

## 6. Verification

- [x] 6.1 Confirm light mode renders Carbon `white` theme and Tailwind `dark:` classes are inactive
- [x] 6.2 Confirm dark mode renders Carbon `g100` theme and Tailwind `dark:` classes are active
- [x] 6.3 Confirm "System" follows OS preference and updates on OS change
- [x] 6.4 Confirm preference persists across app restart
- [x] 6.5 Confirm TitleBar traffic light buttons keep their colors and hover icons adapt
