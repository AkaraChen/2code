CREATE TABLE project_groups (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE projects
ADD COLUMN group_id TEXT REFERENCES project_groups (id) ON DELETE SET NULL;

CREATE INDEX idx_projects_group_id ON projects (group_id);
