## ADDED Requirements

### Requirement: System font enumeration

The system SHALL provide a Tauri command that returns all system-installed font families, each annotated with whether it is a monospace font. The list SHALL be deduplicated by family name and sorted alphabetically.

#### Scenario: Retrieve font list

- **WHEN** the frontend invokes `list_system_fonts`
- **THEN** the backend returns an array of `{ family: string, is_mono: boolean }` objects, sorted by `family` ascending, with no duplicate family names

#### Scenario: Mixed mono and non-mono fonts

- **WHEN** the system has both monospace and proportional fonts installed
- **THEN** each font entry's `is_mono` field accurately reflects whether the font is monospace

### Requirement: Font selector in settings

The settings page SHALL display a font selector dropdown that lists available system fonts for the terminal. The dropdown SHALL default to the user's persisted font choice, or `"JetBrains Mono"` if no preference has been saved.

#### Scenario: Default state on first visit

- **WHEN** the user opens the settings page for the first time (no saved preference)
- **THEN** the font selector displays `"JetBrains Mono"` as the selected value
- **AND** the dropdown lists only monospace fonts

#### Scenario: Select a different font

- **WHEN** the user selects a different font from the dropdown
- **THEN** the selected font is immediately persisted
- **AND** the dropdown reflects the new selection

### Requirement: Mono-only filter with checkbox toggle

The font selector SHALL default to showing only monospace fonts. A checkbox labeled "Show all fonts" (or localized equivalent) SHALL control whether non-monospace fonts are included in the dropdown.

#### Scenario: Default filter state

- **WHEN** the settings page loads
- **THEN** the checkbox is unchecked
- **AND** the font dropdown contains only fonts where `is_mono` is true

#### Scenario: Enable all fonts

- **WHEN** the user checks the "Show all fonts" checkbox
- **THEN** the font dropdown expands to include all system fonts (mono and non-mono)

#### Scenario: Disable all fonts after selecting a non-mono font

- **WHEN** the user has selected a non-mono font and then unchecks the "Show all fonts" checkbox
- **THEN** the dropdown reverts to showing only mono fonts
- **AND** the currently selected font remains unchanged (it is still applied to terminals even though it no longer appears in the filtered list)

### Requirement: Font preference persistence

The user's font selection SHALL be persisted to localStorage and restored on app restart. The persistence SHALL include both the selected font family and the checkbox state.

#### Scenario: Preference survives restart

- **WHEN** the user selects font "Fira Code" and restarts the app
- **THEN** the settings page shows "Fira Code" as selected
- **AND** all terminal instances use "Fira Code"

#### Scenario: Checkbox state survives restart

- **WHEN** the user enables "Show all fonts", selects a non-mono font, and restarts the app
- **THEN** the checkbox is checked
- **AND** the selected non-mono font is still applied

### Requirement: Real-time terminal font update

When the user changes the font selection, all currently open terminal instances SHALL immediately update to use the new font without requiring re-creation of the terminal.

#### Scenario: Live font change with open terminals

- **WHEN** the user changes the font in settings while terminals are open
- **THEN** every open terminal instance updates its rendered font immediately
- **AND** the terminal re-fits to account for potential character width changes

### Requirement: Internationalization

All user-facing labels introduced by the font picker SHALL have translations for both `en` and `zh` locales.

#### Scenario: Chinese locale

- **WHEN** the app language is set to `zh`
- **THEN** the font selector label, checkbox label, and any related UI text display in Chinese
