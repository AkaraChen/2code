import { useMutation, useQuery } from "@tanstack/react-query";
import type { TopbarApp } from "@/generated";
import { listSupportedTopbarApps, openTopbarApp } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { isLaunchAppControlId, type LaunchAppControlId } from "./types";

export function getSupportedTopbarAppIds(apps: readonly TopbarApp[]) {
	const appIds: LaunchAppControlId[] = [];
	for (const app of apps) {
		if (isLaunchAppControlId(app.id)) {
			appIds.push(app.id);
		}
	}
	return appIds;
}

export function useSupportedTopbarAppIds() {
	return useQuery({
		queryKey: queryKeys.topbar.apps,
		queryFn: async () => {
			const apps = await listSupportedTopbarApps();
			return getSupportedTopbarAppIds(apps);
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
