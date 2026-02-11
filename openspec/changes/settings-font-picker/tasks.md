## 1. Backend — System font enumeration

- [x] 1.1 Add `font-kit` dependency to `src-tauri/Cargo.toml`
- [x] 1.2 Create `list_system_fonts` Tauri command that enumerates system fonts, deduplicates by family, annotates `is_mono`, and returns sorted `Vec<SystemFont>`
- [x] 1.3 Register `list_system_fonts` in `lib.rs` invoke handler

## 2. Frontend — Font store

- [x] 2.1 Create `src/stores/fontStore.ts` with Zustand + `persist` middleware (`fontFamily: string`, `showAllFonts: boolean`)
- [x] 2.2 Create `src/api/fonts.ts` with `invoke("list_system_fonts")` wrapper

## 3. Frontend — Settings UI

- [x] 3.1 Add font selector `<NativeSelect>` to `SettingsPage.tsx` (fetches font list, filters by `is_mono` based on checkbox state)
- [x] 3.2 Add "Show all fonts" `<Checkbox>` next to the font selector
- [x] 3.3 Wire font selection change to `fontStore.setFontFamily`

## 4. Terminal integration

- [x] 4.1 Update `Terminal.tsx` to read `fontFamily` from `fontStore` instead of hardcoded value
- [x] 4.2 Add `useEffect` to reactively update `term.options.fontFamily` and re-fit on font change

## 5. Internationalization

- [x] 5.1 Add font-related message keys to `messages/en.json` (`terminalFont`, `showAllFonts`)
- [x] 5.2 Add corresponding Chinese translations to `messages/zh.json`
- [x] 5.3 Compile paraglide messages and use `m.*` in SettingsPage
