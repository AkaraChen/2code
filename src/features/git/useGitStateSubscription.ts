// Event-driven git query invalidation.
//
// Replaces the per-hook 1s refetchInterval with a single subscription that
// listens for `git-state-changed-{profileId}` events emitted by the Rust
// .git/ file watcher (infra::git::watcher). When fired, all git queries
// for that profile are invalidated and TanStack Query refetches them.
//
// Mount once per profile context — typically at the top of GitDiffDialog
// or the future GitPanel. Two mounts for the same profileId are fine; the
// backend's start_git_watcher is idempotent (replaces any existing handle).

import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { queryKeys } from "@/shared/lib/queryKeys";

// These two commands aren't in the generated bindings yet. Run
// `cargo tauri-typegen generate` to refresh, then swap to the typed
// imports from `@/generated`.
const startGitWatcher = (args: { profileId: string }) =>
	invoke<void>("start_git_watcher", args);
const stopGitWatcher = (args: { profileId: string }) =>
	invoke<void>("stop_git_watcher", args);

export function useGitStateSubscription(profileId: string | undefined) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!profileId) return;

		let unlisten: UnlistenFn | undefined;
		let cancelled = false;

		const eventName = `git-state-changed-${profileId}`;

		(async () => {
			try {
				await startGitWatcher({ profileId });
			} catch (err) {
				console.warn("git watcher start failed:", err);
				// Continue anyway — listener may still receive events from a
				// previously started watcher.
			}
			if (cancelled) return;

			unlisten = await listen(eventName, () => {
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.log(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.aheadCount(profileId),
				});
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				});
			});

			if (cancelled) {
				unlisten?.();
				unlisten = undefined;
			}
		})();

		return () => {
			cancelled = true;
			unlisten?.();
			stopGitWatcher({ profileId }).catch(() => {
				// Ignore — best-effort cleanup.
			});
		};
	}, [profileId, queryClient]);
}
