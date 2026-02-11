import { useMutation } from "@tanstack/react-query";
import { ptyApi } from "@/api/pty";
import { useTerminalStore } from "@/stores/terminalStore";

export function useCloseTerminalTab() {
	return useMutation({
		mutationFn: async ({
			sessionId,
		}: {
			projectId: string;
			sessionId: string;
		}) => {
			await ptyApi.close(sessionId).catch(() => {});
			await ptyApi.deleteRecord(sessionId).catch(() => {});
		},
		onSettled: (_data, _err, { projectId, sessionId }) => {
			useTerminalStore.getState().closeTab(projectId, sessionId);
		},
	});
}
