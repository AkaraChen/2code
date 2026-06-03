ALTER TABLE project_groups
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
ADD COLUMN pinned_at TIMESTAMP NULL;

ALTER TABLE projects
ADD COLUMN pinned_order INTEGER NULL;

UPDATE project_groups
SET sort_order = (
	SELECT COUNT(*)
	FROM project_groups AS earlier
	WHERE earlier.created_at < project_groups.created_at
		OR (
			earlier.created_at = project_groups.created_at
			AND earlier.name < project_groups.name
		)
		OR (
			earlier.created_at = project_groups.created_at
			AND earlier.name = project_groups.name
			AND earlier.id <= project_groups.id
		)
) * 1000;

UPDATE projects
SET sort_order = (
	SELECT COUNT(*)
	FROM projects AS earlier
	WHERE earlier.group_id IS projects.group_id
		AND (
			earlier.created_at < projects.created_at
			OR (
				earlier.created_at = projects.created_at
				AND earlier.name < projects.name
			)
			OR (
				earlier.created_at = projects.created_at
				AND earlier.name = projects.name
				AND earlier.id <= projects.id
			)
		)
) * 1000;

CREATE INDEX idx_project_groups_sort_order ON project_groups (sort_order);
CREATE INDEX idx_projects_sidebar_order ON projects (group_id, pinned_order, sort_order);
