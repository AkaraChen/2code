import { Flex } from "@chakra-ui/react";
import { match } from "ts-pattern";
import type { AgentMessageContent } from "../types";
import { MessageBubble } from "./MessageBubble";
import { PlanBlock } from "./PlanBlock";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface AgentResponseGroupProps {
	content: AgentMessageContent[];
}

export function AgentResponseGroup({ content }: AgentResponseGroupProps) {
	return (
		<Flex direction="column" gap="2">
			{content.map((item) =>
				match(item)
					.with({ type: "text" }, (i) => (
						<MessageBubble
							key={i.text}
							message={{
								role: i.role,
								content: i.text,
								timestamp: 0, // timestamp 在 turn 级别
							}}
						/>
					))
					.with({ type: "thought" }, (i) => (
						<ThoughtBlock key={i.text} text={i.text} />
					))
					.with({ type: "tool_call" }, (i) => (
						<ToolCallBlock key={i.data.toolCallId} toolCall={i.data} />
					))
					.with({ type: "plan" }, (i) => (
						<PlanBlock key="plan" plan={i.data} />
					))
					.exhaustive(),
			)}
		</Flex>
	);
}
