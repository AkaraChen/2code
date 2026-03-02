import { useMutation } from "@tanstack/react-query";
import { sessionRegistry } from "@/features/tabs/sessionRegistry";
import { sendAgentPrompt } from "@/generated";
import type { AgentTabSession } from "./AgentTabSession";
import { useAgentStore } from "./store";

export function useSendAgentPrompt() {
	return useMutation({
		mutationFn: async ({
			sessionId,
			content,
		}: {
			sessionId: string;
			content: string;
		}) => {
			useAgentStore.getState().addUserMessage(sessionId, content);
			useAgentStore.getState().setStreaming(sessionId, true);
			await sendAgentPrompt({ sessionId, content });
		},
	});
}

export function useSetAgentModel() {
	return useMutation({
		mutationFn: async ({
			sessionId,
			modelId,
		}: {
			sessionId: string;
			modelId: string;
		}) => {
			const tabSession = sessionRegistry.get(sessionId);
			if (!tabSession || tabSession.type !== "agent") {
				throw new Error(`Agent session not found: ${sessionId}`);
			}
			await (tabSession as AgentTabSession).setModel(modelId);
		},
	});
}
