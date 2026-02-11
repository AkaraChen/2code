import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { ptyApi } from "@/api/pty";
import { queryKeys } from "@/lib/queryKeys";

export function usePtySessions(projectId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.pty.sessions(projectId),
		queryFn: () => ptyApi.listSessions(projectId),
	});
}

export function usePtyHistory(sessionId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.pty.history(sessionId),
		queryFn: () => ptyApi.getHistory(sessionId),
	});
}

export function useDeletePtyRecord() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (sessionId: string) => ptyApi.deleteRecord(sessionId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["pty-sessions"] });
		},
	});
}
