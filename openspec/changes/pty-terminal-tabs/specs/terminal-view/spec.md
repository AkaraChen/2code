## ADDED Requirements

### Requirement: Render terminal with xterm.js
The system SHALL render each terminal tab's content using an xterm.js instance. The terminal SHALL fill the available space in its container.

#### Scenario: Terminal renders on tab creation
- **WHEN** a new tab is created and its PTY session is ready
- **THEN** an xterm.js terminal SHALL be rendered in the tab's content area
- **THEN** the terminal SHALL fill the full width and height of the available space

### Requirement: Stream PTY output to terminal
The system SHALL connect each xterm.js instance to its PTY session's output stream via `resume_stream` with a Tauri `Channel`. Output data SHALL be written to xterm as it arrives.

#### Scenario: Terminal displays command output
- **WHEN** the PTY session produces output (e.g., shell prompt, command results)
- **THEN** the output SHALL appear in the xterm.js terminal in real time

#### Scenario: Buffered output replayed on stream start
- **WHEN** `resume_stream` is called for a session that already has buffered output
- **THEN** the buffered output SHALL be replayed into the terminal before live streaming begins

### Requirement: Send keyboard input to PTY
The system SHALL forward all keyboard input from the xterm.js instance to the PTY session via `write_to_pty`. Input SHALL be sent as raw bytes.

#### Scenario: User types a command
- **WHEN** the user types characters in the terminal
- **THEN** each keystroke SHALL be sent to the PTY via `write_to_pty` as a `Vec<u8>`

### Requirement: Auto-resize terminal
The system SHALL automatically resize the terminal when its container dimensions change. The resize SHALL update both the xterm.js viewport and the PTY session dimensions via `resize_pty`.

#### Scenario: Window resize
- **WHEN** the application window is resized
- **THEN** the xterm.js instance SHALL refit to the new container size using `addon-fit`
- **THEN** `resize_pty` SHALL be called with the new rows and cols values

### Requirement: Clean up on tab close
The system SHALL dispose the xterm.js instance and clean up event listeners when a terminal tab is closed.

#### Scenario: Tab closed
- **WHEN** a tab is closed
- **THEN** the xterm.js instance SHALL be disposed
- **THEN** the Tauri channel for output streaming SHALL be released
