CREATE TABLE pty_output_chunks (
id INTEGER PRIMARY KEY AUTOINCREMENT,
session_id TEXT NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
data BLOB NOT NULL
) ;

CREATE INDEX idx_pty_output_session ON pty_output_chunks (session_id) ;

DROP TABLE IF EXISTS pty_session_output ;
