import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { profilesApi } from "@/api/profiles";
import { queryKeys } from "@/lib/queryKeys";
import { useTerminalStore } from "@/stores/terminalStore";

export function useProfiles(projectId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.profiles.byProject(projectId),
		queryFn: () => profilesApi.list(projectId),
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
		}) => profilesApi.create(projectId, branchName),
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
			profilesApi.delete(id),
		onSuccess: (_data, { id, projectId }) => {
			useTerminalStore.getState().removeProject(id);
			queryClient.invalidateQueries({
				queryKey: queryKeys.profiles.byProject(projectId),
			});
		},
	});
}
