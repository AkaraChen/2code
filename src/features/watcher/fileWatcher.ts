import { Channel } from "@tauri-apps/api/core";
import { watchProjects } from "@/generated";
import type { ProjectWithProfiles, WatchEvent } from "@/generated/types";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();
const INVALIDATION_DEBOUNCE_MS = 1000;
let invalidateTimer: number | null = null;
const pendingProjectIds = new Set<string>();

function invalidateAllProjectQueries() {
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-diff"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-diff-stats"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-status"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-log"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-branch"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-ahead-count"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["fs-tree"]],
		exact: false,
	});
}

function invalidateChangedProjects(projectIds: ReadonlySet<string>) {
	const projects = queryClient.getQueryData<ProjectWithProfiles[]>(
		queryKeys.projects.all,
	);
	if (!projects) {
		invalidateAllProjectQueries();
		return;
	}

	const projectById = new Map(projects.map((project) => [project.id, project]));
	const profileIds = new Set<string>();
	const branchFolders = new Set<string>();
	const fileTreeRoots = new Set<string>();

	for (const projectId of projectIds) {
		const project = projectById.get(projectId);
		if (!project) {
			invalidateAllProjectQueries();
			return;
		}

		fileTreeRoots.add(project.folder);
		for (const profile of project.profiles) {
			profileIds.add(profile.id);
			branchFolders.add(profile.worktree_path);
			fileTreeRoots.add(profile.worktree_path);
		}
	}

	for (const profileId of profileIds) {
		queryClient.invalidateQueries({ queryKey: queryKeys.git.diff(profileId) });
		queryClient.invalidateQueries({
			queryKey: queryKeys.git.diffStats(profileId),
		});
		queryClient.invalidateQueries({
			queryKey: queryKeys.git.status(profileId),
		});
		queryClient.invalidateQueries({ queryKey: queryKeys.git.log(profileId) });
		queryClient.invalidateQueries({
			queryKey: queryKeys.git.aheadCount(profileId),
		});
	}

	for (const folder of branchFolders) {
		queryClient.invalidateQueries({ queryKey: queryKeys.git.branch(folder) });
	}

	for (const root of fileTreeRoots) {
		queryClient.invalidateQueries({
			queryKey: [queryNamespaces["fs-tree"], root],
			exact: false,
		});
	}
}

channel.onmessage = (event) => {
	pendingProjectIds.add(event.project_id);
	// File watcher events arrive in bursts during builds/codegen.
	// Coalesce them so we don't repeatedly re-run full git commands.
	if (invalidateTimer !== null) {
		window.clearTimeout(invalidateTimer);
	}

	invalidateTimer = window.setTimeout(() => {
		invalidateTimer = null;
		const projectIds = new Set(pendingProjectIds);
		pendingProjectIds.clear();

		invalidateChangedProjects(projectIds);
	}, INVALIDATION_DEBOUNCE_MS);
};

watchProjects({ onEvent: channel });
