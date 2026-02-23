import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	addMarketplaceAgent,
	fetchAgentRegistry,
	listMarketplaceAgents,
	removeMarketplaceAgent,
} from "@/generated";
import type { AddMarketplaceAgentInput } from "@/generated/types";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useRegistryAgents() {
	return useSuspenseQuery({
		queryKey: queryKeys.marketplace.registry,
		queryFn: fetchAgentRegistry,
		staleTime: 5 * 60 * 1000, // 5 minutes
	});
}

export function useMarketplaceAgents() {
	return useSuspenseQuery({
		queryKey: queryKeys.marketplace.agents,
		queryFn: listMarketplaceAgents,
	});
}

export function useAddMarketplaceAgent() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: AddMarketplaceAgentInput) =>
			addMarketplaceAgent({ input }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.marketplace.agents,
			});
		},
	});
}

export function useRemoveMarketplaceAgent() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => removeMarketplaceAgent({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.marketplace.agents,
			});
		},
	});
}
