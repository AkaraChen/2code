CREATE TABLE marketplace_agents (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	version TEXT NOT NULL,
	description TEXT,
	icon_url TEXT,
	repository TEXT,
	license TEXT,
	authors_json TEXT NOT NULL DEFAULT '[]',
	added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
