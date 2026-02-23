import { Flex } from "@chakra-ui/react";
import type { AgentTurn } from "../types";
import { Message } from "./Message";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { AgentResponseGroup } from "./AgentResponseGroup";

interface TurnRendererProps {
	turn: AgentTurn;
	agentIconUrl?: string | null;
	agentName?: string;
}

export function TurnRenderer({ turn, agentIconUrl, agentName }: TurnRendererProps) {
	return (
		<Flex direction="column">
			{/* 用户消息 */}
			{turn.userMessage && (
				<Message role="user">
					<MarkdownRenderer content={turn.userMessage} bg="transparent" px="0" py="0" />
				</Message>
			)}

			{/* Agent 响应 */}
			{turn.agentContent.length > 0 && (
				<Message
					role="assistant"
					agentIconUrl={agentIconUrl}
					agentName={agentName}
				>
					<AgentResponseGroup content={turn.agentContent} />
				</Message>
			)}
		</Flex>
	);
}
