import { Flex } from "@chakra-ui/react";
import { match } from "ts-pattern";
import type { AgentMessageContent } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PlanBlock } from "./PlanBlock";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface AgentResponseGroupProps {
	content: AgentMessageContent[];
}

export function AgentResponseGroup({ content }: AgentResponseGroupProps) {
	return (
		<Flex direction="column" gap="4">
			{content.map((item) =>
				match(item)
					.with({ type: "text" }, (i) => (
						<MarkdownRenderer key={i.text} content={i.text} />
					))
					.with({ type: "thought" }, (i) => (
						<ThoughtBlock key={i.text} text={i.text} />
					))
					.with({ type: "tool_call" }, (i) => (
						<ToolCallBlock
							key={i.data.toolCallId}
							toolCall={i.data}
						/>
					))
					.with({ type: "plan" }, (i) => (
						<PlanBlock key="plan" plan={i.data} />
					))
					.exhaustive(),
			)}
		</Flex>
	);
}
