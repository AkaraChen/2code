import { Flex } from "@chakra-ui/react";
import { match } from "ts-pattern";
import * as m from "@/paraglide/messages.js";
import type { StreamingTurn } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Message } from "./Message";
import { PlanBlock } from "./PlanBlock";
import { StreamingBubble } from "./StreamingBubble";
import { TextShimmer } from "./TextShimmer";
import { ThoughtBlock } from "./ThoughtBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface StreamingTurnRendererProps {
	turn: StreamingTurn;
	agentIconUrl?: string | null;
	agentName?: string;
}

export function StreamingTurnRenderer({
	turn,
	agentIconUrl,
	agentName,
}: StreamingTurnRendererProps) {
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

			<Message
				role="assistant"
				agentIconUrl={agentIconUrl}
				agentName={agentName}
			>
				<Flex direction="column" gap="4">
					{agentContent.length === 0 && (
						<TextShimmer>{m.agentThinking()}</TextShimmer>
					)}
					{agentContent.map((item, index) =>
						match(item)
							.with({ type: "text" }, (i) =>
								index === lastTextIndex ? (
									<StreamingBubble
										key={`text-${i.text}`}
										content={i.text}
									/>
								) : (
									<MarkdownRenderer
										key={`text-${i.text}`}
										content={i.text}
									/>
								),
							)
							.with({ type: "thought" }, (i) => (
								<ThoughtBlock
									key={`thought-${i.text}`}
									text={i.text}
								/>
							))
							.with({ type: "tool_call" }, (i) => (
								<ToolCallBlock
									key={i.data.toolCallId}
									toolCall={i.data}
								/>
							))
							.with({ type: "plan" }, (i) => (
								<PlanBlock
									key={`plan-${i.data.entries.map((e) => e.content).join("-")}`}
									plan={i.data}
								/>
							))
							.exhaustive(),
					)}
				</Flex>
			</Message>
		</Flex>
	);
}
