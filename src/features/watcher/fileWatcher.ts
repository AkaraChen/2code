import { Channel } from "@tauri-apps/api/core";
import { watchProjects } from "@/generated";
import type { WatchEvent } from "@/generated/types";
import type { ProjectWithProfiles } from "@/generated";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();
const INVALIDATION_DEBOUNCE_MS = 1000;
let invalidateTimer: number | null = null;
let pendingProjectIds = new Set<string>();

channel.onmessage = (event: WatchEvent) => {
	// Accumulate project IDs during burst events
	if (event?.project_id) {
		pendingProjectIds.add(event.project_id);
	}

	// File watcher events arrive in bursts during builds/codegen.
	// Coalesce them so we don't repeatedly re-run full git commands.
	if (invalidateTimer !== null) {
		window.clearTimeout(invalidateTimer);
	}

	invalidateTimer = window.setTimeout(() => {
		invalidateTimer = null;
		const projectIds = pendingProjectIds;
		pendingProjectIds = new Set<string>();

		// Look up profile IDs for the affected projects so we can scope
		// git query invalidation instead of blanket-invalidating everything.
		const projects = queryClient.getQueryData<ProjectWithProfiles[]>(
			queryKeys.projects.all,
		);
		const affectedProfileIds = new Set<string>();
		const affectedWorktreePaths = new Set<string>();
		const affectedFolderPaths = new Set<string>();

		if (projects) {
			for (const project of projects) {
				if (projectIds.has(project.id)) {
					for (const profile of project.profiles) {
						affectedProfileIds.add(profile.id);
						affectedWorktreePaths.add(profile.worktree_path);
					}
					affectedFolderPaths.add(project.folder);
				}
			}
		}

		// Invalidate git queries only for profiles belonging to changed projects
		if (affectedProfileIds.size > 0) {
			for (const profileId of affectedProfileIds) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.log(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.aheadCount(profileId),
				});
			}
			for (const folder of affectedWorktreePaths) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.branch(folder),
				});
			}
		} else {
			// Fallback: if projects aren't loaded yet, invalidate all (old behavior)
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
		}

		// Invalidate file tree queries for affected project folders
		if (affectedFolderPaths.size > 0) {
			for (const folder of affectedFolderPaths) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(folder),
				});
			}
		} else {
			queryClient.invalidateQueries({
				queryKey: [queryNamespaces["fs-tree"]],
				exact: false,
			});
		}
	}, INVALIDATION_DEBOUNCE_MS);
};

watchProjects({ onEvent: channel });
