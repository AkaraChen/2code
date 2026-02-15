import { useMutation, useQueryClient } from "@tanstack/react-query";
import { installAgent } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

/**
 * Agent 安装 mutation
 * 安装成功后自动刷新 Agent 状态列表
 */
export function useAgentInstall() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (agent: string) => installAgent({ agent }),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.agent.status(),
			});
		},
	});
}
