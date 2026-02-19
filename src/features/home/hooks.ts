import { useSuspenseQuery } from "@tanstack/react-query";
import { getHomepageStats } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useHomepageStats() {
	return useSuspenseQuery({
		queryKey: queryKeys.stats.homepage,
		queryFn: getHomepageStats,
		staleTime: 30_000,
	});
}
