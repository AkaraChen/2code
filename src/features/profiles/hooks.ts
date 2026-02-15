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
		mutationFn: async ({
			id,
			projectId: _projectId,
		}: {
			id: string;
			projectId: string;
		}) => {
			// Step 1: Close all tabs for this profile
			await closeAllTabsForProfile(id);

			// Step 2: Delete profile from backend
			await deleteProfile({ id });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
