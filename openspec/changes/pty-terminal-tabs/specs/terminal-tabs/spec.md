## ADDED Requirements

### Requirement: Create new terminal tab
The system SHALL create a new terminal tab when the user clicks the "+" button in the tab bar. Each new tab SHALL spawn an independent PTY session via `create_pty` and display it immediately as the active tab.

#### Scenario: User creates first tab
- **WHEN** the page loads with no existing tabs
- **THEN** the system SHALL automatically create one terminal tab so the user sees a working terminal immediately

#### Scenario: User creates additional tab
- **WHEN** the user clicks the "+" button in the tab bar
- **THEN** a new tab SHALL be created with a new PTY session
- **THEN** the new tab SHALL become the active tab

### Requirement: Close terminal tab
The system SHALL allow users to close any tab by clicking the close button on that tab. Closing a tab SHALL destroy the associated PTY session via `delete_pty`.

#### Scenario: Close a tab with multiple tabs open
- **WHEN** the user clicks the close button on a tab and more than one tab exists
- **THEN** the tab and its PTY session SHALL be destroyed
- **THEN** an adjacent tab SHALL become active (prefer the tab to the right, or the last tab if the closed tab was rightmost)

#### Scenario: Close the last remaining tab
- **WHEN** the user closes the only remaining tab
- **THEN** a new tab SHALL be automatically created to replace it (the page always has at least one tab)

### Requirement: Switch between tabs
The system SHALL allow users to switch between tabs by clicking on a tab in the tab bar. Switching tabs SHALL show the selected terminal and hide the others without destroying them.

#### Scenario: Switch to another tab
- **WHEN** the user clicks on an inactive tab
- **THEN** the clicked tab SHALL become active and its terminal SHALL be visible
- **THEN** the previously active terminal SHALL be hidden but remain alive (not unmounted)

### Requirement: Tab display
Each tab in the tab bar SHALL display a label. The label SHALL be "Terminal N" where N is a sequential counter that increments for each new tab created during the session.

#### Scenario: Tab labeling
- **WHEN** the user creates their first, second, and third tabs
- **THEN** the tabs SHALL be labeled "Terminal 1", "Terminal 2", "Terminal 3" respectively
