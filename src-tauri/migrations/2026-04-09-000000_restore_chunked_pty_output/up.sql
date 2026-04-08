CREATE TABLE pty_output_chunks (
id INTEGER PRIMARY KEY AUTOINCREMENT,
session_id TEXT NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
data BLOB NOT NULL,
byte_len INTEGER NOT NULL
) ;

CREATE INDEX idx_pty_output_session ON pty_output_chunks (session_id, id) ;

INSERT INTO pty_output_chunks (session_id, data, byte_len)
SELECT session_id, data, LENGTH(data)
FROM pty_session_output
WHERE LENGTH(data) > 0 ;

DROP TABLE IF EXISTS pty_session_output ;
