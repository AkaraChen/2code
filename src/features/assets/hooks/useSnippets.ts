import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import {
	createSnippet,
	deleteSnippet,
	listSnippets,
	updateSnippet,
} from "@/generated";
import type { UpdateSnippet } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useSnippets() {
	return useSuspenseQuery({
		queryKey: queryKeys.snippets.all,
		queryFn: listSnippets,
	});
}

export function useCreateSnippet() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: {
			name: string;
			trigger: string;
			content: string;
		}) => createSnippet(args),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.snippets.all,
			});
		},
	});
}

export function useUpdateSnippet() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			changeset,
		}: {
			id: string;
			changeset: UpdateSnippet;
		}) => updateSnippet({ id, changeset }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.snippets.all,
			});
		},
	});
}

export function useDeleteSnippet() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteSnippet({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.snippets.all,
			});
		},
	});
}
