import { useMutation } from "@tanstack/react-query";
import { sendAgentPrompt } from "@/generated";
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
