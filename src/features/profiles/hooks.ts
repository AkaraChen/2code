import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTerminalStore } from "@/features/terminal/store";
import { createProfile, deleteProfile } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useCreateProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			projectId,
			branchName,
		}: {
			projectId: string;
			branchName: string;
		}) => createProfile({ projectId, branchName }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useDeleteProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id }: { id: string; projectId: string }) =>
			deleteProfile({ id }),
		onSuccess: (_data, { id }) => {
			useTerminalStore.getState().removeProfile(id);
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
