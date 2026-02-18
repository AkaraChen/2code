import { Flex } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import type { StreamingTurn } from "../types";
import { MessageBubble } from "./MessageBubble";
import { PlanBlock } from "./PlanBlock";
import { StreamingBubble } from "./StreamingBubble";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface StreamingTurnRendererProps {
	turn: StreamingTurn;
}

export function StreamingTurnRenderer({ turn }: StreamingTurnRendererProps) {
	const [timestamp] = useState(() => Date.now());
	const thoughtText = useMemo(
		() => turn.thoughtChunks.join(""),
		[turn.thoughtChunks],
	);
	const textContent = useMemo(
		() => turn.textChunks.join(""),
		[turn.textChunks],
	);

	return (
		<Flex direction="column" gap="3">
			{turn.userMessage && (
				<MessageBubble
					message={{
						role: "user",
						content: turn.userMessage,
						timestamp,
					}}
				/>
			)}

			<Flex direction="column" gap="2">
				{thoughtText && <ThoughtBlock text={thoughtText} />}

				{Array.from(turn.toolCalls.values()).map((toolCall) => (
					<ToolCallBlock key={toolCall.toolCallId} toolCall={toolCall} />
				))}

				{turn.plan && <PlanBlock plan={turn.plan} />}

				{textContent && <StreamingBubble content={textContent} />}
			</Flex>
		</Flex>
	);
}
