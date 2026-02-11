import { useMutation } from "@tanstack/react-query";
import { ptyApi } from "@/api/pty";
import { useTerminalStore } from "@/stores/terminalStore";

export function useCloseTerminalTab() {
	return useMutation({
		mutationFn: async ({
			projectId,
			sessionId,
		}: {
			projectId: string;
			sessionId: string;
		}) => {
			await ptyApi.close(sessionId);
			await ptyApi.deleteRecord(sessionId);
			return { projectId, sessionId };
		},
		onSuccess: ({ projectId, sessionId }) => {
			useTerminalStore.getState().closeTab(projectId, sessionId);
		},
		onError: (_err, { projectId, sessionId }) => {
			// Dead session — remove ghost tab and clean DB record
			useTerminalStore.getState().closeTab(projectId, sessionId);
			ptyApi.deleteRecord(sessionId).catch(() => {});
		},
	});
}
