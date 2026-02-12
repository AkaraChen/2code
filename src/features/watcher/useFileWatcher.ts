import { useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useEffectOnceWhen } from "rooks";
import { watchProjects } from "@/generated";
import type { WatchEvent } from "@/generated/types";
import { queryNamespaces } from "@/shared/lib/queryKeys";

export function useFileWatcher() {
	const queryClient = useQueryClient();

	useEffectOnceWhen(() => {
		const channel = new Channel<WatchEvent>();

		channel.onmessage = (_event) => {
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
	});
}
