CREATE TABLE pty_output_state (
session_id TEXT PRIMARY KEY NOT NULL
REFERENCES pty_sessions (id) ON DELETE CASCADE,
total_bytes INTEGER NOT NULL DEFAULT 0
) ;

INSERT INTO pty_output_state (session_id, total_bytes)
SELECT s.id, COALESCE(SUM(c.byte_len), 0)
FROM pty_sessions s
LEFT JOIN pty_output_chunks c ON c.session_id = s.id
GROUP BY s.id ;
