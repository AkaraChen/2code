import { Flex } from "@chakra-ui/react";
import { ErrorBoundary } from "react-error-boundary";
import type { AgentTurn } from "../types";
import { AgentResponseGroup } from "./AgentResponseGroup";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Message } from "./Message";

interface TurnRendererProps {
	turn: AgentTurn;
	agentIconUrl?: string | null;
	agentName?: string;
}

export function TurnRenderer({
	turn,
	agentIconUrl,
	agentName,
}: TurnRendererProps) {
	return (
		<ErrorBoundary
			fallbackRender={({ error }) => (
				<Flex px="4" py="1" fontSize="xs" color="fg.error">
					⚠ {error instanceof Error ? error.message : String(error)}
				</Flex>
			)}
		>
			<Flex direction="column">
				{/* 用户消息 */}
				{turn.userMessage && (
					<Message role="user">
						<MarkdownRenderer
							content={turn.userMessage}
							bg="transparent"
							px="0"
							py="0"
						/>
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
		</ErrorBoundary>
	);
}
