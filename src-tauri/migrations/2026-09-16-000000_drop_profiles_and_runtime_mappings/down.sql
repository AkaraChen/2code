-- Best-effort reverse of the DROP. Recreates empty mapping tables and
-- default profile stubs from projects; leftover extras cannot be restored.
CREATE TABLE profiles (
	id TEXT PRIMARY KEY NOT NULL,
	project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
	branch_name TEXT NOT NULL,
	worktree_path TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	is_default BOOLEAN NOT NULL DEFAULT 0,
	notes TEXT NOT NULL DEFAULT ''
);

INSERT INTO profiles (id, project_id, branch_name, worktree_path, created_at, is_default, notes)
SELECT
	'default-' || id,
	id,
	'main',
	folder,
	created_at,
	1,
	COALESCE(
		(
			SELECT notes FROM checkout_notes
			WHERE checkout_notes.project_id = projects.id
				AND checkout_notes.checkout_path = projects.folder
		),
		''
	)
FROM projects;

CREATE INDEX idx_profiles_project_id ON profiles (project_id);

CREATE TABLE herdr_namespaces (
	name TEXT PRIMARY KEY NOT NULL
);
INSERT INTO herdr_namespaces (name) VALUES ('2code');

CREATE TABLE profile_runtime_mappings (
	profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
	namespace TEXT NOT NULL REFERENCES herdr_namespaces (name),
	workspace_id TEXT NOT NULL,
	UNIQUE (namespace, workspace_id)
);

CREATE TABLE pty_sessions_old (
	id TEXT PRIMARY KEY NOT NULL,
	profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
	title TEXT NOT NULL DEFAULT '',
	shell TEXT NOT NULL,
	cwd TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	closed_at TIMESTAMP,
	cols INTEGER NOT NULL DEFAULT 80,
	rows INTEGER NOT NULL DEFAULT 24
);

INSERT INTO pty_sessions_old (
	id, profile_id, title, shell, cwd, created_at, closed_at, cols, rows
)
SELECT
	s.id,
	CASE
		WHEN EXISTS (SELECT 1 FROM profiles p WHERE p.id = s.profile_id)
			THEN s.profile_id
		ELSE 'default-' || s.project_id
	END,
	s.title,
	s.shell,
	s.cwd,
	s.created_at,
	s.closed_at,
	s.cols,
	s.rows
FROM pty_sessions s
INNER JOIN profiles p ON p.id = CASE
	WHEN EXISTS (SELECT 1 FROM profiles x WHERE x.id = s.profile_id)
		THEN s.profile_id
	ELSE 'default-' || s.project_id
END;

DROP TABLE pty_sessions;
ALTER TABLE pty_sessions_old RENAME TO pty_sessions;
CREATE INDEX idx_pty_sessions_profile_id ON pty_sessions (profile_id);

CREATE TABLE session_runtime_mappings (
	session_id TEXT PRIMARY KEY NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
	namespace TEXT NOT NULL REFERENCES herdr_namespaces (name),
	workspace_id TEXT NOT NULL,
	pane_id TEXT NOT NULL,
	UNIQUE (namespace, pane_id)
);

DROP TABLE checkout_notes;
