PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_projects_group_id;

CREATE TABLE projects_without_groups (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	folder TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO projects_without_groups (id, name, folder, created_at)
SELECT id, name, folder, created_at FROM projects;

DROP TABLE projects;
ALTER TABLE projects_without_groups RENAME TO projects;

DROP TABLE project_groups;

PRAGMA foreign_keys = ON;
