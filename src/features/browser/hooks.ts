import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useInstalledBrowsers(enabled = true) {
	return useQuery({
		queryKey: queryKeys.browsers.installed,
		queryFn: async () => {
			const { listInstalledBrowsers } = await import("@/generated");
			return listInstalledBrowsers();
		},
		enabled,
	});
}
