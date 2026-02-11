import { useMutation } from "@tanstack/react-query";
import { ptyApi } from "@/api/pty";
import { useTerminalStore } from "@/stores/terminalStore";

const DEFAULT_SHELL = "/bin/zsh";

export function useCreateTerminalTab() {
	return useMutation({
		mutationFn: async ({
			contextId,
			projectId,
			cwd,
		}: {
			contextId: string;
			projectId: string;
			cwd: string;
		}) => {
			const counter =
				useTerminalStore.getState().projects[contextId]?.counter ?? 0;
			const title = `Terminal ${counter + 1}`;
			const sessionId = await ptyApi.createSession(
				projectId,
				title,
				DEFAULT_SHELL,
				cwd,
				24,
				80,
			);
			return { contextId, sessionId, title };
		},
		onSuccess: ({ contextId, sessionId, title }) => {
			useTerminalStore.getState().addTab(contextId, sessionId, title);
		},
	});
}
