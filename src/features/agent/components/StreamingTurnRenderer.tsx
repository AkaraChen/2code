import { Flex } from "@chakra-ui/react";
import { useMemo } from "react";
import type { StreamingTurn } from "../types";
import { Message } from "./Message";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PlanBlock } from "./PlanBlock";
import { StreamingBubble } from "./StreamingBubble";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface StreamingTurnRendererProps {
	turn: StreamingTurn;
}

export function StreamingTurnRenderer({ turn }: StreamingTurnRendererProps) {
	const thoughtText = useMemo(
		() => turn.thoughtChunks.join(""),
		[turn.thoughtChunks],
	);
	const textContent = useMemo(
		() => turn.textChunks.join(""),
		[turn.textChunks],
	);

	return (
		<Flex direction="column">
			{turn.userMessage && (
				<Message role="user">
					<MarkdownRenderer content={turn.userMessage} />
				</Message>
			)}

			<Message role="assistant">
				<Flex direction="column" gap="4">
					{thoughtText && <ThoughtBlock text={thoughtText} />}

					{Array.from(turn.toolCalls.values()).map((toolCall) => (
						<ToolCallBlock key={toolCall.toolCallId} toolCall={toolCall} />
					))}

					{turn.plan && <PlanBlock plan={turn.plan} />}

					{textContent && <StreamingBubble content={textContent} />}
				</Flex>
			</Message>
		</Flex>
	);
}
