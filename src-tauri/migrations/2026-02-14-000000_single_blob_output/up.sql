CREATE TABLE pty_session_output (
session_id TEXT PRIMARY KEY NOT NULL
REFERENCES pty_sessions (id) ON DELETE CASCADE,
data BLOB NOT NULL DEFAULT X ''
) ;

INSERT INTO pty_session_output (session_id, data)
SELECT id, X '' FROM pty_sessions ;

DROP INDEX IF EXISTS idx_pty_output_session ;
DROP TABLE IF EXISTS pty_output_chunks ;
