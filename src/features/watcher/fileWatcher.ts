import { Channel } from "@tauri-apps/api/core";
import { watchProjects } from "@/generated";
import type { WatchEvent } from "@/generated/types";
import { queryClient } from "@/shared/lib/queryClient";
import { queryNamespaces } from "@/shared/lib/queryKeys";

const channel = new Channel<WatchEvent>();

channel.onmessage = () => {
	// Invalidate all git queries by prefix — simple and correct since
	// file watcher emits project_id but git queries use profileId
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-diff"]],
		exact: false,
	});
	queryClient.invalidateQueries({
		queryKey: [queryNamespaces["git-log"]],
		exact: false,
	});
};

watchProjects({ onEvent: channel });
