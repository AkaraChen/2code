import { Box, Button, EmptyState, Flex, HStack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import * as m from "@/paraglide/messages.js";
import { AgentIcon } from "@/shared/components/AgentIcon";
import type { AgentTurn, StreamingTurn } from "../types";
import { TurnRenderer } from "./TurnRenderer";
import { StreamingTurnRenderer } from "./StreamingTurnRenderer";

const SUGGESTION_ITEMS = [
	{
		label: m.agentChatSuggestionProject,
		prompt:
			"What is this project? Please summarize its purpose, architecture, and how to get started.",
	},
	{
		label: m.agentChatSuggestionCodeQuality,
		prompt:
			"Scan this codebase for code quality issues, potential bugs, and maintainability risks. Provide prioritized findings with file references.",
	},
	{
		label: m.agentChatSuggestionNextTask,
		prompt:
			"Based on this repository, suggest the best next task to work on and explain why it should be prioritized now.",
	},
] as const;

interface MessageListProps {
	turns: AgentTurn[] | undefined;
	isStreaming: boolean;
	streamingTurn: StreamingTurn | null | undefined;
	error: string | undefined;
	agentIconUrl?: string | null;
	agentName?: string;
	onSuggestionSelect?: (prompt: string) => void;
}

export function MessageList({
	turns,
	isStreaming,
	streamingTurn,
	error,
	agentIconUrl,
	agentName,
	onSuggestionSelect,
}: MessageListProps) {
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const hasMessages = (turns?.length ?? 0) > 0 || Boolean(streamingTurn);
	const showEmptyState = !hasMessages && !isStreaming && !error;

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [turns?.length, streamingTurn]);

	return (
		<Box flex="1" overflowY="auto" py="4">
			<Flex direction="column" minH="full" justify="flex-end">
				{showEmptyState && (
					<Flex align="center" justify="center" flex="1" px="4">
						<EmptyState.Root>
							<EmptyState.Content>
								<EmptyState.Indicator>
									<AgentIcon
										iconUrl={agentIconUrl}
										size={24}
										alt={agentName ?? m.agentDefaultName()}
									/>
								</EmptyState.Indicator>
								<VStack textAlign="center">
									<EmptyState.Title>
										{m.agentChatEmptyState()}
									</EmptyState.Title>
								</VStack>
								<HStack wrap="wrap" justify="center">
									{SUGGESTION_ITEMS.map((item) => (
										<Button
											key={item.prompt}
											size="sm"
											variant="subtle"
											onClick={() =>
												onSuggestionSelect?.(item.prompt)}
										>
											{item.label()}
										</Button>
									))}
								</HStack>
							</EmptyState.Content>
						</EmptyState.Root>
					</Flex>
				)}

				{turns?.map((turn) => (
					<TurnRenderer
						key={turn.timestamp}
						turn={turn}
						agentIconUrl={agentIconUrl}
						agentName={agentName}
					/>
				))}

				{isStreaming && streamingTurn && (
					<StreamingTurnRenderer
						turn={streamingTurn}
						agentIconUrl={agentIconUrl}
						agentName={agentName}
					/>
				)}

				{error && !isStreaming && (
					<Box
						px="4"
						py="2"
						mx="4"
						my="2"
						borderRadius="lg"
						bg="red.subtle"
						fontSize="sm"
					>
						<Text color="red.fg">{error}</Text>
					</Box>
				)}

				<div ref={messagesEndRef} />
			</Flex>
		</Box>
	);
}
