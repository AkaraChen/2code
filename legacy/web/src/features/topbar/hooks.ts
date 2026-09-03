import { useMutation, useQuery } from "@tanstack/react-query";
import { listSupportedTopbarApps, openTopbarApp } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { isLaunchAppId, type LaunchAppId } from "./types";

export function useSupportedTopbarAppIds() {
	return useQuery({
		queryKey: queryKeys.topbar.apps,
		queryFn: async () => {
			const apps = await listSupportedTopbarApps();
			return apps.map((app) => app.id).filter(isLaunchAppId);
		},
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
}

export function useOpenTopbarApp() {
	return useMutation({
		mutationFn: ({
			appId,
			path,
		}: {
			appId: LaunchAppId;
			path: string;
		}) => openTopbarApp({ appId, path }),
	});
}
