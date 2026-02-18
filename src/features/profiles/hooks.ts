import { useMutation, useQueryClient } from "@tanstack/react-query";
import { closeAllTabsForProfile } from "@/features/tabs/utils";
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
		mutationFn: async ({ id }: { id: string; projectId: string }) => {
			await closeAllTabsForProfile(id);
			await deleteProfile({ id });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
