-- 1. Add is_default to profiles
ALTER TABLE profiles ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT 0;

-- 2. Create default profile for every existing project
INSERT INTO profiles (id, project_id, branch_name, worktree_path, is_default)
SELECT 'default-' || id, id, 'main', folder, 1 FROM projects;

-- 3. Recreate pty_sessions with profile_id FK instead of project_id
CREATE TABLE pty_sessions_new (
	id TEXT PRIMARY KEY NOT NULL,
	profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	shell TEXT NOT NULL,
	cwd TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	closed_at TIMESTAMP
);

INSERT INTO pty_sessions_new (
	id, profile_id, title, shell, cwd, created_at, closed_at
)
SELECT
	s.id,
	COALESCE(
		(SELECT p.id FROM profiles p WHERE p.worktree_path = s.cwd LIMIT 1),
		'default-' || s.project_id
	),
	s.title, s.shell, s.cwd, s.created_at, s.closed_at
FROM pty_sessions s;

DROP TABLE pty_output_chunks;
DROP TABLE pty_sessions;
ALTER TABLE pty_sessions_new RENAME TO pty_sessions;

CREATE TABLE pty_output_chunks (
id INTEGER PRIMARY KEY AUTOINCREMENT,
session_id TEXT NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
data BLOB NOT NULL
) ;
CREATE INDEX idx_pty_output_session ON pty_output_chunks (session_id) ;
