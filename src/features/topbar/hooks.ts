import { useMutation, useQuery } from "@tanstack/react-query";
import { listSupportedTopbarApps, openTopbarApp } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { isLaunchAppControlId, type LaunchAppControlId } from "./types";

export function useSupportedTopbarAppIds() {
	return useQuery({
		queryKey: queryKeys.topbar.apps,
		queryFn: async () => {
			const apps = await listSupportedTopbarApps();
			return apps.map((app) => app.id).filter(isLaunchAppControlId);
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
			appId: LaunchAppControlId;
			path: string;
		}) => openTopbarApp({ appId, path }),
	});
}
