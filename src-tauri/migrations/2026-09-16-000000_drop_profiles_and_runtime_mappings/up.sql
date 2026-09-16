-- Move leftover profile notes onto a 2code table keyed by project +
-- checkout path, give pty_sessions a projects FK (no profiles FK), then
-- DROP mapping tables and profiles. sqlite profiles is not source of
-- truth after this migration.
CREATE TABLE checkout_notes (
	project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	checkout_path TEXT NOT NULL,
	notes TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (project_id, checkout_path)
);

INSERT INTO checkout_notes (project_id, checkout_path, notes, created_at)
SELECT p.project_id, p.worktree_path, p.notes, p.created_at
FROM profiles p
INNER JOIN (
	SELECT project_id, worktree_path, MAX(rowid) AS rowid
	FROM profiles
	WHERE notes != '' AND worktree_path != ''
	GROUP BY project_id, worktree_path
) latest ON latest.rowid = p.rowid;

CREATE INDEX idx_checkout_notes_project_id ON checkout_notes (project_id);

DROP TABLE session_runtime_mappings;

CREATE TABLE pty_sessions_new (
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

INSERT INTO pty_sessions_new (
	id, project_id, profile_id, title, shell, cwd, created_at, closed_at, cols, rows
)
SELECT
	s.id,
	resolved.project_id,
	s.profile_id,
	s.title,
	s.shell,
	s.cwd,
	s.created_at,
	s.closed_at,
	s.cols,
	s.rows
FROM pty_sessions s
INNER JOIN (
	SELECT
		s2.id AS session_id,
		COALESCE(
			p.project_id,
			CASE
				WHEN s2.profile_id LIKE 'default-%' THEN substr(s2.profile_id, 9)
			END
		) AS project_id
	FROM pty_sessions s2
	LEFT JOIN profiles p ON p.id = s2.profile_id
) resolved ON resolved.session_id = s.id
INNER JOIN projects pr ON pr.id = resolved.project_id;

DROP TABLE pty_sessions;
ALTER TABLE pty_sessions_new RENAME TO pty_sessions;
CREATE INDEX idx_pty_sessions_profile_id ON pty_sessions (profile_id);
CREATE INDEX idx_pty_sessions_project_id ON pty_sessions (project_id);

DROP TABLE profile_runtime_mappings;
DROP TABLE herdr_namespaces;
DROP TABLE profiles;
