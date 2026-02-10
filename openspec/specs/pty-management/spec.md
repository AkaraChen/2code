### Requirement: Create a PTY session
The system SHALL spawn a new PTY process and return a session object. The caller MAY specify shell path, working directory, environment variables, and initial terminal size. If not specified, the system SHALL use the user's default shell, home directory, inherited environment, and 80×24 size. Each session SHALL be assigned a unique UUID v4 identifier.

#### Scenario: Create with defaults
- **WHEN** the frontend invokes `create_pty` with no parameters
- **THEN** the system spawns a PTY using the user's default shell, home directory, inherited env, and 80×24 size, and returns a session info object containing the new session ID, shell path, cwd, size, and created_at timestamp

#### Scenario: Create with custom config
- **WHEN** the frontend invokes `create_pty` with `shell: "/bin/zsh"`, `cwd: "/tmp"`, `rows: 40`, `cols: 120`
- **THEN** the system spawns a PTY with the specified shell, working directory, and size, and returns a session info object reflecting those values

#### Scenario: Create with invalid shell path
- **WHEN** the frontend invokes `create_pty` with `shell: "/nonexistent/shell"`
- **THEN** the system SHALL return an error indicating the shell could not be spawned

### Requirement: Get PTY session info
The system SHALL return metadata for a single session by ID, including its ID, shell path, working directory, terminal size, and creation timestamp. The response SHALL NOT include the raw PTY handle or output buffer.

#### Scenario: Get existing session
- **WHEN** the frontend invokes `get_pty` with a valid session ID
- **THEN** the system returns the session info object for that session

#### Scenario: Get non-existent session
- **WHEN** the frontend invokes `get_pty` with an ID that does not match any active session
- **THEN** the system SHALL return an error indicating the session was not found

### Requirement: List PTY sessions
The system SHALL return a list of all active session info objects. If no sessions exist, the system SHALL return an empty list.

#### Scenario: List with active sessions
- **WHEN** two sessions have been created and neither deleted
- **THEN** invoking `list_pty` returns a list containing both session info objects

#### Scenario: List with no sessions
- **WHEN** no sessions exist
- **THEN** invoking `list_pty` returns an empty list

### Requirement: Update PTY session (resize)
The system SHALL support resizing an active PTY session's terminal dimensions. The resize SHALL take effect immediately on the underlying PTY.

#### Scenario: Resize an active session
- **WHEN** the frontend invokes `resize_pty` with a valid session ID, `rows: 50`, `cols: 200`
- **THEN** the system resizes the PTY to 50×200 and the session info reflects the new dimensions

#### Scenario: Resize a non-existent session
- **WHEN** the frontend invokes `resize_pty` with an unknown session ID
- **THEN** the system SHALL return an error indicating the session was not found

### Requirement: Delete a PTY session
The system SHALL kill the child process, clean up all resources (PTY master, reader, output buffer, stream task), and remove the session from the registry. After deletion, the session ID SHALL no longer be valid for any operation.

#### Scenario: Delete an active session
- **WHEN** the frontend invokes `delete_pty` with a valid session ID
- **THEN** the system kills the child process, removes the session from the registry, and subsequent calls with that ID return a not-found error

#### Scenario: Delete a non-existent session
- **WHEN** the frontend invokes `delete_pty` with an unknown session ID
- **THEN** the system SHALL return an error indicating the session was not found

#### Scenario: Delete a session with an active stream
- **WHEN** a session has an active output stream and the frontend invokes `delete_pty` for that session
- **THEN** the system SHALL abort the stream task, kill the child process, and remove the session
