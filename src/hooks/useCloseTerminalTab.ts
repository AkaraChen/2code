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
			await Promise.all([
				ptyApi.close(sessionId).catch(() => {}),
				ptyApi.deleteRecord(sessionId).catch(() => {}),
			]);
		},
		onSettled: (_data, _err, { projectId, sessionId }) => {
			useTerminalStore.getState().closeTab(projectId, sessionId);
		},
	});
}
