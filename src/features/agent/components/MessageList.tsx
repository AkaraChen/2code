import { Box, Flex, Text } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import * as m from "@/paraglide/messages.js";
import type { AgentMessage } from "../store";
import { MessageBubble } from "./MessageBubble";
import { StreamingBubble } from "./StreamingBubble";

interface MessageListProps {
	messages: AgentMessage[] | undefined;
	isStreaming: boolean;
	streamContent: string | undefined;
	error: string | undefined;
}

/**
 * 消息列表组件
 * 显示历史消息、流式输出和错误状态
 */
export function MessageList({
	messages,
	isStreaming,
	streamContent,
	error,
}: MessageListProps) {
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamContent]);

	return (
		<Box flex="1" overflowY="auto" px="4" py="4">
			<Flex direction="column" gap="3" minH="full" justify="flex-end">
				{messages?.length === 0 && !isStreaming && (
					<Flex
						align="center"
						justify="center"
						flex="1"
						color="fg.muted"
					>
						<Text fontSize="sm">{m.agentChatEmptyState()}</Text>
					</Flex>
				)}
				{messages?.map((msg) => (
					<MessageBubble key={msg.timestamp} message={msg} />
				))}
				{isStreaming && <StreamingBubble content={streamContent ?? ""} />}
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
