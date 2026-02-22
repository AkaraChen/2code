import { Box, Flex, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import * as m from "@/paraglide/messages.js";
import type { AgentTurn, StreamingTurn } from "../types";
import { TurnRenderer } from "./TurnRenderer";
import { StreamingTurnRenderer } from "./StreamingTurnRenderer";

const errorBoxStyles = {
	px: "4",
	py: "2",
	mx: "4",
	my: "2",
	borderRadius: "lg",
	bg: "red.subtle",
	fontSize: "sm",
} as const;

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

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [turns?.length, streamingTurn]);

	return (
		<Box flex="1" overflowY="auto" py="4">
			<Flex direction="column" minH="full" justify="flex-end">
				{turns?.length === 0 && !isStreaming && (
					<Flex align="center" justify="center" flex="1" color="fg.muted">
						<Text fontSize="sm">{m.agentChatEmptyState()}</Text>
					</Flex>
				)}

				{turns?.map((turn) => (
					<TurnRenderer key={turn.timestamp} turn={turn} />
				))}

				{isStreaming && streamingTurn && (
					<StreamingTurnRenderer turn={streamingTurn} />
				)}

				{error && !isStreaming && (
					<Box {...errorBoxStyles}>
						<Text color="red.fg">{error}</Text>
					</Box>
				)}

				<div ref={messagesEndRef} />
			</Flex>
		</Box>
	);
}
