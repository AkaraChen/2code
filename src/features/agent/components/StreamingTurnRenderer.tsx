import { Flex } from "@chakra-ui/react";
import { useState } from "react";
import type { StreamingTurn } from "../types";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { PlanBlock } from "./PlanBlock";

interface StreamingTurnRendererProps {
	turn: StreamingTurn;
}

export function StreamingTurnRenderer({ turn }: StreamingTurnRendererProps) {
	const [timestamp] = useState(() => Date.now());

	return (
		<Flex direction="column" gap="3">
			{/* 用户消息 */}
			{turn.userMessage && (
				<MessageBubble
					message={{
						role: "user",
						content: turn.userMessage,
						timestamp,
					}}
				/>
			)}

			{/* Agent 响应（流式） */}
			<Flex direction="column" gap="2">
				{/* 思考块（如果有） */}
				{turn.thoughtChunks.length > 0 && (
					<ThoughtBlock text={turn.thoughtChunks.join("")} />
				)}

				{/* 工具调用（如果有） */}
				{Array.from(turn.toolCalls.values()).map((toolCall) => (
					<ToolCallBlock key={toolCall.toolCallId} toolCall={toolCall} />
				))}

				{/* 计划（如果有） */}
				{turn.plan && <PlanBlock plan={turn.plan} />}

				{/* 文本消息（流式） */}
				{turn.textChunks.length > 0 && (
					<StreamingBubble content={turn.textChunks.join("")} />
				)}
			</Flex>
		</Flex>
	);
}
