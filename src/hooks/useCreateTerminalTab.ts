import { useMutation } from "@tanstack/react-query";
import { ptyApi } from "@/api/pty";
import { useTerminalStore } from "@/stores/terminalStore";

const DEFAULT_SHELL = "/bin/zsh";

export function useCreateTerminalTab() {
	return useMutation({
		mutationFn: async ({
			projectId,
			cwd,
		}: {
			projectId: string;
			cwd: string;
		}) => {
			const counter =
				useTerminalStore.getState().projects[projectId]?.counter ?? 0;
			const title = `Terminal ${counter + 1}`;
			const sessionId = await ptyApi.createSession(
				projectId,
				title,
				DEFAULT_SHELL,
				cwd,
				24,
				80,
			);
			return { projectId, sessionId, title };
		},
		onSuccess: ({ projectId, sessionId, title }) => {
			useTerminalStore.getState().addTab(projectId, sessionId, title);
		},
	});
}
