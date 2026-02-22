import { Box, Flex, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
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

/**
 * Message list component
 * Displays historical turns, streaming output, and error state
 */
export function MessageList({
	turns,
	isStreaming,
	streamingTurn,
	error,
}: MessageListProps) {
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [turns?.length, streamingTurn]);

	return (
		<Box flex="1" overflowY="auto" px="4" py="4">
			<Flex direction="column" gap="4" minH="full" justify="flex-end">
				{/* Empty state */}
				{turns?.length === 0 && !isStreaming && (
					<Flex
						align="center"
						justify="center"
						flex="1"
						color="fg.muted"
					>
						<Text fontSize="sm">{m.agentChatEmptyState()}</Text>
					</Flex>
				)}

				{/* Completed turns */}
				{turns?.map((turn) => (
					<TurnRenderer key={turn.timestamp} turn={turn} />
				))}

				{/* Streaming turn */}
				{isStreaming && streamingTurn && (
					<StreamingTurnRenderer turn={streamingTurn} />
				)}

				{/* Error */}
				{error && !isStreaming && (
					<Box
						px="4"
						py="2"
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
