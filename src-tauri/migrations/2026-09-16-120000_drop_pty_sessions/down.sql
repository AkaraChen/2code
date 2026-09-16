-- Recreate the Task 8 pty_sessions shape (projects FK, no profiles FK).
CREATE TABLE pty_sessions (
	id TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	profile_id TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	shell TEXT NOT NULL,
	cwd TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	closed_at TIMESTAMP,
	cols INTEGER NOT NULL DEFAULT 80,
	rows INTEGER NOT NULL DEFAULT 24
);
CREATE INDEX idx_pty_sessions_profile_id ON pty_sessions (profile_id);
CREATE INDEX idx_pty_sessions_project_id ON pty_sessions (project_id);
