import {
	Box,
	Button,
	Flex,
	HStack,
	Spinner,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiSendPlaneLine } from "react-icons/ri";
import { useSendAgentPrompt } from "./hooks";
import type { AgentMessage } from "./store";
import { useAgentStore } from "./store";

interface AgentChatProps {
	sessionId: string;
}

function MessageBubble({ message }: { message: AgentMessage }) {
	const isUser = message.role === "user";
	return (
		<Flex justify={isUser ? "flex-end" : "flex-start"} w="full">
			<Box
				maxW="80%"
				px="4"
				py="2"
				borderRadius="lg"
				bg={isUser ? "colorPalette.subtle" : "bg.muted"}
				whiteSpace="pre-wrap"
				fontSize="sm"
			>
				<Text>{message.content}</Text>
			</Box>
		</Flex>
	);
}

function StreamingBubble({ content }: { content: string }) {
	if (!content) return null;
	return (
		<Flex justify="flex-start" w="full">
			<Box
				maxW="80%"
				px="4"
				py="2"
				borderRadius="lg"
				bg="bg.muted"
				whiteSpace="pre-wrap"
				fontSize="sm"
			>
				<Text>{content}</Text>
				<Spinner size="xs" ml="2" />
			</Box>
		</Flex>
	);
}

export function AgentChat({ sessionId }: AgentChatProps) {
	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const sendPrompt = useSendAgentPrompt();

	const messages = useAgentStore(
		(s) => s.sessions[sessionId]?.messages ?? [],
	);
	const isStreaming = useAgentStore(
		(s) => s.sessions[sessionId]?.isStreaming ?? false,
	);
	const streamContent = useAgentStore(
		(s) => s.sessions[sessionId]?.streamContent ?? "",
	);
	const error = useAgentStore((s) => s.sessions[sessionId]?.error ?? null);

	// Auto-scroll to bottom
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, streamContent]);

	const handleSend = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || isStreaming) return;
		setInput("");
		sendPrompt.mutate({ sessionId, content: trimmed });
	}, [input, isStreaming, sendPrompt, sessionId]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	return (
		<Flex direction="column" h="full" w="full" bg="bg">
			{/* Message list */}
			<Box flex="1" overflowY="auto" px="4" py="4">
				<Flex direction="column" gap="3" minH="full" justify="flex-end">
					{messages.length === 0 && !isStreaming && (
						<Flex
							align="center"
							justify="center"
							flex="1"
							color="fg.muted"
						>
							<Text fontSize="sm">
								Send a message to start the conversation.
							</Text>
						</Flex>
					)}
					{messages.map((msg) => (
						<MessageBubble key={msg.timestamp} message={msg} />
					))}
					{isStreaming && <StreamingBubble content={streamContent} />}
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

			{/* Input area */}
			<Box
				px="4"
				py="3"
				borderTop="1px solid"
				borderColor="border.subtle"
			>
				<HStack gap="2" align="flex-end">
					<Textarea
						flex="1"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
						size="sm"
						resize="none"
						rows={1}
						maxH="120px"
						disabled={isStreaming}
						autoresize
					/>
					<Button
						size="sm"
						onClick={handleSend}
						disabled={!input.trim() || isStreaming}
						colorPalette="blue"
					>
						<RiSendPlaneLine />
					</Button>
				</HStack>
			</Box>
		</Flex>
	);
}
