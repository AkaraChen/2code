import { Channel } from "@tauri-apps/api/core";
import { watchProjects } from "@/generated";
import type { WatchEvent } from "@/generated/types";
import { queryClient } from "@/shared/lib/queryClient";
import { queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();
const INVALIDATION_DEBOUNCE_MS = 1000;
let invalidateTimer: number | null = null;

channel.onmessage = () => {
	// File watcher events arrive in bursts during builds/codegen.
	// Coalesce them so we don't repeatedly re-run full git commands.
	if (invalidateTimer !== null) {
		window.clearTimeout(invalidateTimer);
	}

	invalidateTimer = window.setTimeout(() => {
		invalidateTimer = null;

		// Invalidate all git queries by prefix — simple and correct since
		// file watcher emits project_id but git queries use profileId.
		queryClient.invalidateQueries({
			queryKey: [queryNamespaces["git-diff"]],
			exact: false,
		});
		queryClient.invalidateQueries({
			queryKey: [queryNamespaces["git-diff-stats"]],
			exact: false,
		});
		queryClient.invalidateQueries({
			queryKey: [queryNamespaces["git-log"]],
			exact: false,
		});
		queryClient.invalidateQueries({
			queryKey: [queryNamespaces["fs-dir"]],
			exact: false,
		});
	}, INVALIDATION_DEBOUNCE_MS);
};

watchProjects({ onEvent: channel });
