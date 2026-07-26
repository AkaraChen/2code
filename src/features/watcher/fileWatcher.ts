import { Channel } from "@tauri-apps/api/core";
import consola from "consola";
import { watchProjects } from "@/generated";
import type { ProjectWithProfiles, WatchEvent } from "@/generated/types";
import { queryClient } from "@/shared/lib/queryClient";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();
const INVALIDATION_DEBOUNCE_MS = 1000;
const INVALIDATION_MAX_WAIT_MS = 3000;
const MAX_PENDING_EVENTS = 500;
let invalidateTimer: number | null = null;
let maxWaitTimer: number | null = null;
const pendingEvents = new Map<string, WatchEvent>();

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
	return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function pendingEventKey(event: WatchEvent) {
	return `${event.project_id}\u0000${event.profile_id ?? ""}\u0000${event.path ?? ""}`;
}

function invalidateCachedFileQueriesForPaths(
	namespace: string,
	profileId: string,
	changedPaths: ReadonlySet<string>,
) {
	queryClient.invalidateQueries({
		predicate: (query) => {
			const key = query.queryKey;
			if (key[0] !== namespace || key[1] !== profileId) return false;
			const cachedPath = key[2];
			if (typeof cachedPath !== "string") return false;

			let candidate = normalizeFilePath(cachedPath);
			for (;;) {
				if (changedPaths.has(candidate)) return true;
				const slash = candidate.lastIndexOf("/");
				if (slash === -1) return false;
				candidate = candidate.slice(0, slash);
			}
		},
	});
}

function invalidateChangedEvents(events: readonly WatchEvent[]) {
	const projects = queryClient.getQueryData<ProjectWithProfiles[]>(
		queryKeys.projects.all,
	);
	const projectById = projects
		? new Map(projects.map((project) => [project.id, project]))
		: null;
	const profileIds = new Set<string>();
	const fileInvalidations = new Map<string, Set<string | null>>();

	for (const event of events) {
		if (event.profile_id) {
			profileIds.add(event.profile_id);
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
		queryClient.invalidateQueries({
			queryKey: queryKeys.fs.treeChildrenPrefix(profileId),
			exact: false,
		});
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

		const changedPaths = new Set<string>();
		for (const path of paths) {
			if (path == null) continue;
			changedPaths.add(normalizeFilePath(path));
		}
		if (changedPaths.size === 0) continue;

		invalidateCachedFileQueriesForPaths(
			queryNamespaces["fs-file"],
			profileId,
			changedPaths,
		);
		invalidateCachedFileQueriesForPaths(
			queryNamespaces["fs-file-preview"],
			profileId,
			changedPaths,
		);
	}
}

function flushPendingEvents() {
	if (invalidateTimer !== null) {
		window.clearTimeout(invalidateTimer);
		invalidateTimer = null;
	}
	if (maxWaitTimer !== null) {
		window.clearTimeout(maxWaitTimer);
		maxWaitTimer = null;
	}
	if (pendingEvents.size === 0) return;

	const events = [...pendingEvents.values()];
	pendingEvents.clear();
	invalidateChangedEvents(events);
}

channel.onmessage = (event) => {
	pendingEvents.set(pendingEventKey(event), event);
	if (pendingEvents.size > MAX_PENDING_EVENTS) {
		const collapsed = new Map<string, WatchEvent>();
		for (const pending of pendingEvents.values()) {
			const wide: WatchEvent = { ...pending, path: null };
			collapsed.set(pendingEventKey(wide), wide);
		}
		pendingEvents.clear();
		for (const [key, wide] of collapsed) pendingEvents.set(key, wide);
	}

	// File watcher events arrive in bursts during builds/codegen.
	// Arm once so sustained activity cannot starve invalidation forever.
	if (invalidateTimer === null) {
		invalidateTimer = window.setTimeout(
			flushPendingEvents,
			INVALIDATION_DEBOUNCE_MS,
		);
	}

	if (maxWaitTimer === null) {
		maxWaitTimer = window.setTimeout(
			flushPendingEvents,
			INVALIDATION_MAX_WAIT_MS,
		);
	}
};

watchProjects({ onEvent: channel }).catch((error) => {
	consola.error("[file-watcher] failed to start project watcher", error);
});
