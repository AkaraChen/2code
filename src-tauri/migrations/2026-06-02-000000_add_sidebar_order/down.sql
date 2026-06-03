PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_projects_sidebar_order;
DROP INDEX IF EXISTS idx_project_groups_sort_order;

CREATE TABLE project_groups_without_sidebar_order (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO project_groups_without_sidebar_order (id, name, created_at)
SELECT id, name, created_at FROM project_groups;

DROP TABLE project_groups;
ALTER TABLE project_groups_without_sidebar_order RENAME TO project_groups;

CREATE TABLE projects_without_sidebar_order (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	folder TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	group_id TEXT REFERENCES project_groups (id) ON DELETE SET NULL
);

INSERT INTO projects_without_sidebar_order (id, name, folder, created_at, group_id)
SELECT id, name, folder, created_at, group_id FROM projects;

DROP TABLE projects;
ALTER TABLE projects_without_sidebar_order RENAME TO projects;

CREATE INDEX idx_projects_group_id ON projects (group_id);

PRAGMA foreign_keys = ON;
