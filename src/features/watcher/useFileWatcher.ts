import { useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { watchProjects } from "@/generated";
import type { WatchEvent } from "@/generated/types";

export function useFileWatcher() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const channel = new Channel<WatchEvent>();

		channel.onmessage = (_event) => {
			// Invalidate all git queries by prefix — simple and correct since
			// file watcher emits project_id but git queries use profileId
			queryClient.invalidateQueries({
				queryKey: ["git-diff"],
			});
			queryClient.invalidateQueries({
				queryKey: ["git-log"],
			});
		};

		watchProjects({ onEvent: channel });
	}, [queryClient]);
}
