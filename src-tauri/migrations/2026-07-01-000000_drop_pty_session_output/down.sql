CREATE TABLE pty_session_output (
    session_id TEXT PRIMARY KEY NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
    data BLOB NOT NULL DEFAULT X''
);
