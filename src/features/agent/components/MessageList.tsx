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
 * 消息列表组件
 * 显示历史 turns、流式输出和错误状态
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
	}, [turns, streamingTurn]);

	return (
		<Box flex="1" overflowY="auto" px="4" py="4">
			<Flex direction="column" gap="4" minH="full" justify="flex-end">
				{/* 空状态 */}
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

				{/* 已完成的 turns */}
				{turns?.map((turn, i) => (
					<TurnRenderer key={i} turn={turn} />
				))}

				{/* 流式 turn */}
				{isStreaming && streamingTurn && (
					<StreamingTurnRenderer turn={streamingTurn} />
				)}

				{/* 错误 */}
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
