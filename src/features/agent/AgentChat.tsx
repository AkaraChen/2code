import { Flex } from "@chakra-ui/react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useSendAgentPrompt } from "./hooks";
import { useAgentStore } from "./store";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";

interface AgentChatProps {
	sessionId: string;
}

/**
 * Agent 聊天界面主容器
 * 组合消息列表和输入框,管理发送逻辑
 */
export function AgentChat({ sessionId }: AgentChatProps) {
	const sendPrompt = useSendAgentPrompt();

	const { turns, isStreaming, streamingTurn, error } = useAgentStore(
		useShallow((s) => {
			const session = s.sessions[sessionId];
			return {
				turns: session?.turns,
				isStreaming: session?.isStreaming,
				streamingTurn: session?.streamingTurn,
				error: session?.error,
			};
		}),
	);

	const handleSend = useCallback(
		(content: string) => {
			sendPrompt.mutate({ sessionId, content });
		},
		[sendPrompt, sessionId],
	);

	return (
		<Flex direction="column" h="full" w="full" bg="bg">
			<MessageList
				turns={turns}
				isStreaming={isStreaming ?? false}
				streamingTurn={streamingTurn}
				error={error ?? undefined}
			/>
			<ChatInput onSend={handleSend} disabled={isStreaming ?? false} />
		</Flex>
	);
}
