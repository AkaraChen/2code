import { useMutation } from "@tanstack/react-query";
import { closePtySession, deletePtySessionRecord } from "@/generated";
import { useTerminalStore } from "@/stores/terminalStore";

export function useCloseTerminalTab() {
	return useMutation({
		mutationFn: async ({
			sessionId,
		}: {
			contextId: string;
			sessionId: string;
		}) => {
			await Promise.all([
				closePtySession({ sessionId }).catch(() => {}),
				deletePtySessionRecord({ sessionId }).catch(() => {}),
			]);
		},
		onSettled: (_data, _err, { contextId, sessionId }) => {
			useTerminalStore.getState().closeTab(contextId, sessionId);
		},
	});
}
