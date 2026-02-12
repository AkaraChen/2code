import { useQueryClient } from "@tanstack/react-query";
import { Channel } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { watchProjects } from "@/generated";
import type { WatchEvent } from "@/generated/types";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useFileWatcher() {
	const queryClient = useQueryClient();

	useEffect(() => {
		const channel = new Channel<WatchEvent>();

		channel.onmessage = (event) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.projects.diff(event.project_id),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.projects.log(event.project_id),
			});
		};

		watchProjects({ onEvent: channel });
	}, [queryClient]);
}
