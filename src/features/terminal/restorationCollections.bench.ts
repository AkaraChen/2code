import { bench, describe } from "vitest";
import type { ProjectWithProfiles, PtySessionRecord } from "@/generated";
import { collectProjectSessions } from "./restorationCollections";

const projects: ProjectWithProfiles[] = Array.from(
	{ length: 500 },
	(_, projectIndex) => ({
		id: `project-${projectIndex}`,
		name: `Project ${projectIndex}`,
		folder: `/repo/project-${projectIndex}`,
		created_at: "2026-01-01T00:00:00Z",
		group_id: null,
		profiles: Array.from({ length: 6 }, (_, profileIndex) => ({
			id: `profile-${projectIndex}-${profileIndex}`,
			project_id: `project-${projectIndex}`,
			branch_name: `branch-${profileIndex}`,
			worktree_path: `/workspace/${projectIndex}/${profileIndex}`,
			created_at: "2026-01-01T00:00:00Z",
			is_default: profileIndex === 0,
		})),
	}),
);

const projectSessions = projects.map((project) => ({
	project,
	sessions: Array.from({ length: 4 }, (_, index): PtySessionRecord => ({
		id: `session-${project.id}-${index}`,
		profile_id: project.profiles[index % project.profiles.length].id,
		title: `Session ${index}`,
		shell: "/bin/zsh",
		cwd: project.folder,
		cols: 120,
		rows: 30,
		created_at: "2026-01-01T00:00:00Z",
		closed_at: null,
	})),
}));

function collectSessionsWithFlatMap() {
	return projectSessions.flatMap(({ sessions }) => sessions);
}

describe("terminal restoration collection building", () => {
	bench("flatMap sessions", () => {
		collectSessionsWithFlatMap();
	});

	bench("preallocated sessions", () => {
		collectProjectSessions(projectSessions);
	});
});
