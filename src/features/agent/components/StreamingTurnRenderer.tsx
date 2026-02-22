import { Flex } from "@chakra-ui/react";
import { match } from "ts-pattern";
import * as m from "@/paraglide/messages.js";
import type { StreamingTurn } from "../types";
import { Message } from "./Message";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PlanBlock } from "./PlanBlock";
import { StreamingBubble } from "./StreamingBubble";
import { TextShimmer } from "./TextShimmer";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface StreamingTurnRendererProps {
	turn: StreamingTurn;
}

export function StreamingTurnRenderer({ turn }: StreamingTurnRendererProps) {
	const { agentContent } = turn;

	// Find the last text entry index to render it as StreamingBubble
	let lastTextIndex = -1;
	for (let i = agentContent.length - 1; i >= 0; i--) {
		if (agentContent[i].type === "text") {
			lastTextIndex = i;
			break;
		}
	}

	return (
		<Flex direction="column">
			{turn.userMessage && (
				<Message role="user">
					<MarkdownRenderer content={turn.userMessage} />
				</Message>
			)}

			<Message role="assistant">
				<Flex direction="column" gap="4">
					{agentContent.length === 0 && (
						<TextShimmer>{m.agentThinking()}</TextShimmer>
					)}
					{agentContent.map((item, index) =>
						match(item)
							.with({ type: "text" }, (i) =>
								index === lastTextIndex ? (
									<StreamingBubble
										key={`text-${index}`}
										content={i.text}
									/>
								) : (
									<MarkdownRenderer
										key={`text-${index}`}
										content={i.text}
									/>
								),
							)
							.with({ type: "thought" }, (i) => (
								<ThoughtBlock key={`thought-${index}`} text={i.text} />
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
			</Message>
		</Flex>
	);
}
