import { Channel } from "@tauri-apps/api/core";
import { watchProjects } from "@/generated";
import type { ProjectWithProfiles, WatchEvent } from "@/generated/types";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();
const INVALIDATION_DEBOUNCE_MS = 1000;
let invalidateTimer: number | null = null;
const pendingEvents: WatchEvent[] = [];

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
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["fs-file"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["fs-file-preview"]],
		exact: false,
	});
}

function addFileInvalidation(
	fileInvalidations: Map<string, Set<string | null>>,
	profileId: string,
	path: string | null | undefined,
) {
	const paths = fileInvalidations.get(profileId) ?? new Set<string | null>();
	const normalizedPath = path == null ? null : normalizeFilePath(path);
	paths.add(normalizedPath || null);
	fileInvalidations.set(profileId, paths);
}

function normalizeFilePath(path: string) {
	return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function isSameOrDescendantPath(candidatePath: string, changedPath: string) {
	const normalizedCandidate = normalizeFilePath(candidatePath);
	const normalizedChanged = normalizeFilePath(changedPath);
	return (
		normalizedCandidate === normalizedChanged
		|| normalizedCandidate.startsWith(`${normalizedChanged}/`)
	);
}

function invalidateMatchingCachedFileQueries(
	namespace: string,
	profileId: string,
	changedPath: string,
) {
	const queries = queryClient.getQueryCache().findAll({
		queryKey: [namespace, profileId],
	});

	for (const query of queries) {
		const queryKey = query.queryKey;
		const cachedPath = queryKey[2];
		if (
			typeof cachedPath !== "string"
			|| normalizeFilePath(cachedPath) === changedPath
			|| !isSameOrDescendantPath(cachedPath, changedPath)
		) {
			continue;
		}

		queryClient.invalidateQueries({ queryKey });
	}
}

function invalidateChangedEvents(events: readonly WatchEvent[]) {
	const projects = queryClient.getQueryData<ProjectWithProfiles[]>(
		queryKeys.projects.all,
	);
	const projectById = projects
		? new Map(projects.map((project) => [project.id, project]))
		: null;
	const profileIds = new Set<string>();
	const branchFolders = new Set<string>();
	const fileInvalidations = new Map<string, Set<string | null>>();

	for (const event of events) {
		if (event.profile_id) {
			profileIds.add(event.profile_id);
			branchFolders.add(event.root_path);
			addFileInvalidation(fileInvalidations, event.profile_id, event.path);
			continue;
		}

		const project = projectById?.get(event.project_id);
		if (!project) {
			invalidateAllProjectQueries();
			return;
		}

		for (const profile of project.profiles) {
			profileIds.add(profile.id);
			branchFolders.add(profile.worktree_path);
			addFileInvalidation(fileInvalidations, profile.id, null);
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
		queryClient.invalidateQueries({
			queryKey: queryKeys.fs.tree(profileId),
			exact: false,
		});
	}

	for (const folder of branchFolders) {
		queryClient.invalidateQueries({ queryKey: queryKeys.git.branch(folder) });
	}

	for (const [profileId, paths] of fileInvalidations) {
		if (paths.has(null)) {
			queryClient.invalidateQueries({
				queryKey: [queryNamespaces["fs-file"], profileId],
				exact: false,
			});
			queryClient.invalidateQueries({
				queryKey: [queryNamespaces["fs-file-preview"], profileId],
				exact: false,
			});
			continue;
		}

		for (const path of paths) {
			if (path == null) continue;
			const normalizedPath = normalizeFilePath(path);
			queryClient.invalidateQueries({
				queryKey: queryKeys.fs.file(profileId, normalizedPath),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.fs.filePreview(profileId, normalizedPath),
			});
			invalidateMatchingCachedFileQueries(
				queryNamespaces["fs-file"],
				profileId,
				normalizedPath,
			);
			invalidateMatchingCachedFileQueries(
				queryNamespaces["fs-file-preview"],
				profileId,
				normalizedPath,
			);
		}
	}
}

channel.onmessage = (event) => {
	pendingEvents.push(event);
	// File watcher events arrive in bursts during builds/codegen.
	// Coalesce them so we don't repeatedly re-run full git commands.
	if (invalidateTimer !== null) {
		window.clearTimeout(invalidateTimer);
	}

	invalidateTimer = window.setTimeout(() => {
		invalidateTimer = null;
		const events = pendingEvents.splice(0);

		invalidateChangedEvents(events);
	}, INVALIDATION_DEBOUNCE_MS);
};

watchProjects({ onEvent: channel });
