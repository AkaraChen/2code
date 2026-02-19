import { useMutation, useQueryClient } from "@tanstack/react-query";
import { installAgent } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";
import { toaster } from "@/shared/providers/Toaster";

interface InstallAgentParams {
	id: string;
	displayName: string;
}

/**
 * Agent 安装 mutation
 * 安装成功后自动刷新 Agent 状态列表，并显示 toast 反馈
 */
export function useAgentInstall() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id }: InstallAgentParams) => installAgent({ agent: id }),
		onSuccess: (_, { displayName }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.agent.status(),
			});
			toaster.success({
				title: m.agentInstallSuccess({ name: displayName }),
			});
		},
		onError: (error, { displayName }) => {
			toaster.error({
				title: m.agentInstallFailed({ name: displayName }),
				description:
					error instanceof Error ? error.message : String(error),
			});
		},
	});
}
