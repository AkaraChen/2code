-- Reverse: recreate pty_sessions with project_id FK
DROP TABLE pty_output_chunks;
DROP TABLE pty_sessions;

CREATE TABLE pty_sessions (
	id TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	shell TEXT NOT NULL,
	cwd TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	closed_at TIMESTAMP
);

CREATE TABLE pty_output_chunks (
id INTEGER PRIMARY KEY AUTOINCREMENT,
session_id TEXT NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
data BLOB NOT NULL
) ;
CREATE INDEX idx_pty_output_session ON pty_output_chunks (session_id) ;

-- Remove default profiles
DELETE FROM profiles WHERE is_default = 1 ;

-- Remove is_default column (SQLite doesn't support DROP COLUMN before 3.35)
CREATE TABLE profiles_backup (
id TEXT PRIMARY KEY NOT NULL,
project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
branch_name TEXT NOT NULL,
worktree_path TEXT NOT NULL,
created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ;

INSERT INTO profiles_backup SELECT id,
project_id,
branch_name,
worktree_path,
created_at FROM profiles ;
DROP TABLE profiles ;
ALTER TABLE profiles_backup RENAME TO profiles ;
