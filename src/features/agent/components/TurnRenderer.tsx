import { Flex } from "@chakra-ui/react";
import type { AgentTurn } from "../types";
import { MessageBubble } from "./MessageBubble";
import { AgentResponseGroup } from "./AgentResponseGroup";

interface TurnRendererProps {
	turn: AgentTurn;
}

export function TurnRenderer({ turn }: TurnRendererProps) {
	return (
		<Flex direction="column" gap="3">
			{/* 用户消息 */}
			{turn.userMessage && (
				<MessageBubble
					message={{
						role: "user",
						content: turn.userMessage,
						timestamp: turn.timestamp,
					}}
				/>
			)}

			{/* Agent 响应 */}
			{turn.agentContent.length > 0 && (
				<AgentResponseGroup content={turn.agentContent} />
			)}
		</Flex>
	);
}
