import { Channel } from "@tauri-apps/api/core";
import { watchProjects } from "@/generated";
import type { ProjectWithProfiles, WatchEvent } from "@/generated/types";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();
const INVALIDATION_DEBOUNCE_MS = 1000;
let invalidateTimer: number | null = null;
let pendingProjectId: string | null = null;

channel.onmessage = (event: WatchEvent) => {
	// File watcher events arrive in bursts during builds/codegen.
	// Coalesce them so we don't repeatedly re-run full git commands.
	if (invalidateTimer !== null) {
		window.clearTimeout(invalidateTimer);
	}

	pendingProjectId = event.project_id;

	invalidateTimer = window.setTimeout(() => {
		invalidateTimer = null;
		const projectId = pendingProjectId;
		pendingProjectId = null;

		const projects = queryClient.getQueryData<ProjectWithProfiles[]>(queryKeys.projects.all);
		const project = projects?.find((p) => p.id === projectId);

		if (!project) {
			// Projects not in cache yet — fall back to invalidating everything.
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
				queryKey: [queryNamespaces["fs-tree"]],
				exact: false,
			});
			return;
		}

		for (const profile of project.profiles) {
			queryClient.invalidateQueries({ queryKey: queryKeys.git.diff(profile.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.git.diffStats(profile.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.git.status(profile.id) });
			queryClient.invalidateQueries({ queryKey: queryKeys.git.log(profile.id) });
			queryClient.invalidateQueries({
				queryKey: queryKeys.fs.tree(profile.worktree_path),
				exact: false,
			});
		}
	}, INVALIDATION_DEBOUNCE_MS);
};

watchProjects({ onEvent: channel });
