import { Flex } from "@chakra-ui/react";
import type { AgentMessageContent } from "../types";
import { MessageBubble } from "./MessageBubble";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";
import { PlanBlock } from "./PlanBlock";

interface AgentResponseGroupProps {
	content: AgentMessageContent[];
}

export function AgentResponseGroup({ content }: AgentResponseGroupProps) {
	return (
		<Flex direction="column" gap="2">
			{content.map((item, i) => {
				switch (item.type) {
					case "text":
						return (
							<MessageBubble
								key={i}
								message={{
									role: item.role,
									content: item.text,
									timestamp: 0, // timestamp 在 turn 级别
								}}
							/>
						);
					case "thought":
						return <ThoughtBlock key={i} text={item.text} />;
					case "tool_call":
						return <ToolCallBlock key={i} toolCall={item.data} />;
					case "plan":
						return <PlanBlock key={i} plan={item.data} />;
				}
			})}
		</Flex>
	);
}
