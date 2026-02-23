import { Box, EmptyState, Flex, Text, VStack } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import { RiRobot2Line } from "react-icons/ri";
import * as m from "@/paraglide/messages.js";
import type { AgentTurn, StreamingTurn } from "../types";
import { TurnRenderer } from "./TurnRenderer";
import { StreamingTurnRenderer } from "./StreamingTurnRenderer";

interface MessageListProps {
	turns: AgentTurn[] | undefined;
	isStreaming: boolean;
	streamingTurn: StreamingTurn | null | undefined;
	error: string | undefined;
}

export function MessageList({
	turns,
	isStreaming,
	streamingTurn,
	error,
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
									<RiRobot2Line />
								</EmptyState.Indicator>
								<VStack textAlign="center">
									<EmptyState.Title>
										{m.agentChatEmptyState()}
									</EmptyState.Title>
									<EmptyState.Description>
										{m.agentChatPlaceholder()}
									</EmptyState.Description>
								</VStack>
							</EmptyState.Content>
						</EmptyState.Root>
					</Flex>
				)}

				{turns?.map((turn) => (
					<TurnRenderer key={turn.timestamp} turn={turn} />
				))}

				{isStreaming && streamingTurn && (
					<StreamingTurnRenderer turn={streamingTurn} />
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
