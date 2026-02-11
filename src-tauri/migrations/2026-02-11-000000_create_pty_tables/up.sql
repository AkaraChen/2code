CREATE TABLE pty_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    shell TEXT NOT NULL,
    cwd TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMP
);

CREATE TABLE pty_output_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES pty_sessions(id) ON DELETE CASCADE,
    data BLOB NOT NULL
);

CREATE INDEX idx_pty_output_session ON pty_output_chunks(session_id);
