import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useTerminalStore } from "@/features/terminal/store";
import { createProfile, deleteProfile, listProfiles } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useProfiles(projectId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.profiles.byProject(projectId),
		queryFn: () => listProfiles({ projectId }),
	});
}

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
		onSuccess: (_data, { projectId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.profiles.byProject(projectId),
			});
		},
	});
}

export function useDeleteProfile() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id }: { id: string; projectId: string }) =>
			deleteProfile({ id }),
		onSuccess: (_data, { id, projectId }) => {
			useTerminalStore.getState().removeProject(id);
			queryClient.invalidateQueries({
				queryKey: queryKeys.profiles.byProject(projectId),
			});
		},
	});
}
