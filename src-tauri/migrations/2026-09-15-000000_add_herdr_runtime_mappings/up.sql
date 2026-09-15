-- Additive Herdr runtime mapping. Does not rewrite projects, profiles,
-- or pty_sessions. worktree_path stays a checkout cache, not workspace
-- authority. Identities are workspace_id / pane_id in namespace 2code.
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

CREATE TABLE session_runtime_mappings (
	session_id TEXT PRIMARY KEY NOT NULL REFERENCES pty_sessions (id) ON DELETE CASCADE,
	namespace TEXT NOT NULL REFERENCES herdr_namespaces (name),
	workspace_id TEXT NOT NULL,
	pane_id TEXT NOT NULL,
	UNIQUE (namespace, pane_id)
);
