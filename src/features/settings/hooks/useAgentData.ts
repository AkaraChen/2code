import { useSuspenseQuery } from "@tanstack/react-query";
import { detectCredentials, listAgentStatus } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

/**
 * 获取 Agent 状态列表
 */
export function useAgentStatus() {
	return useSuspenseQuery({
		queryKey: queryKeys.agent.status(),
		queryFn: listAgentStatus,
	});
}

/**
 * 检测凭证状态 (Anthropic + OpenAI)
 */
export function useCredentials() {
	return useSuspenseQuery({
		queryKey: queryKeys.agent.credentials(),
		queryFn: detectCredentials,
	});
}
