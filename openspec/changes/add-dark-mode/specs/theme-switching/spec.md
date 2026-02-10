## ADDED Requirements

### Requirement: OS color scheme detection

The system SHALL detect the operating system's color scheme preference (light or dark) on application launch and apply the corresponding theme automatically.

#### Scenario: OS prefers dark

- **WHEN** the OS color scheme is set to dark and no user preference is stored
- **THEN** the app renders with Carbon theme `g100` (dark)

#### Scenario: OS prefers light

- **WHEN** the OS color scheme is set to light and no user preference is stored
- **THEN** the app renders with Carbon theme `white` (light)

#### Scenario: OS preference changes at runtime

- **WHEN** the user's preference is set to "System" and the OS color scheme changes while the app is running
- **THEN** the app theme SHALL update to match the new OS preference without requiring a restart

### Requirement: Manual theme override

The system SHALL provide a theme selector in the Settings page with three options: System, Light, and Dark.

#### Scenario: User selects Light

- **WHEN** the user selects "Light" in the theme selector
- **THEN** the app renders with Carbon theme `white` regardless of OS preference

#### Scenario: User selects Dark

- **WHEN** the user selects "Dark" in the theme selector
- **THEN** the app renders with Carbon theme `g100` regardless of OS preference

#### Scenario: User selects System

- **WHEN** the user selects "System" in the theme selector
- **THEN** the app theme follows the OS color scheme preference

### Requirement: Theme preference persistence

The system SHALL persist the user's theme preference across application restarts.

#### Scenario: Preference survives restart

- **WHEN** the user sets theme to "Dark" and restarts the app
- **THEN** the app launches with Carbon theme `g100`

#### Scenario: No stored preference defaults to System

- **WHEN** no theme preference exists in storage (first launch)
- **THEN** the system behaves as if "System" is selected

### Requirement: Carbon component theming

All Carbon Design System components SHALL render with the correct color tokens for the active theme.

#### Scenario: Carbon components in dark mode

- **WHEN** the active theme is `g100`
- **THEN** all Carbon components (SideNav, Select, buttons, etc.) use Carbon's dark theme CSS custom properties

#### Scenario: Carbon components in light mode

- **WHEN** the active theme is `white`
- **THEN** all Carbon components use Carbon's light theme CSS custom properties

### Requirement: Tailwind dark variant integration

Tailwind CSS utility classes with the `dark:` variant SHALL activate when a Carbon dark theme (`g90` or `g100`) is active.

#### Scenario: Dark Tailwind utilities activate

- **WHEN** the Carbon theme is `g100`
- **THEN** Tailwind classes prefixed with `dark:` are applied (e.g., `dark:text-white`)

#### Scenario: Dark Tailwind utilities inactive in light mode

- **WHEN** the Carbon theme is `white`
- **THEN** Tailwind classes prefixed with `dark:` are not applied

### Requirement: TitleBar dark mode adaptation

The TitleBar SHALL visually adapt to the active theme while preserving macOS traffic light button colors.

#### Scenario: TitleBar in dark mode

- **WHEN** the active theme is `g100`
- **THEN** the TitleBar background uses Carbon's `--cds-layer` token (dark value) and traffic light button hover icons use light-colored text

#### Scenario: TitleBar in light mode

- **WHEN** the active theme is `white`
- **THEN** the TitleBar background uses Carbon's `--cds-layer` token (light value) and traffic light button hover icons use dark-colored text

#### Scenario: Traffic light colors unchanged

- **WHEN** the theme switches between light and dark
- **THEN** the red (#ff5f57), yellow (#febc2e), and green (#28c840) button backgrounds remain unchanged
