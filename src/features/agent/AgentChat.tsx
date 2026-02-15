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
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { useShallow } from "zustand/react/shallow";
import "highlight.js/styles/github-dark.css";
import { Prose } from "@/components/ui/prose";
import * as m from "@/paraglide/messages.js";
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
				fontSize="sm"
				overflow="auto"
			>
				<Prose maxW="none" my="0">
					<Markdown
						remarkPlugins={[remarkGfm]}
						rehypePlugins={[rehypeHighlight]}
					>
						{message.content}
					</Markdown>
				</Prose>
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
				fontSize="sm"
				overflow="auto"
			>
				<Prose maxW="none" my="0">
					<Markdown
						remarkPlugins={[remarkGfm]}
						rehypePlugins={[rehypeHighlight]}
					>
						{content}
					</Markdown>
				</Prose>
				<Spinner size="xs" ml="2" />
			</Box>
		</Flex>
	);
}

export function AgentChat({ sessionId }: AgentChatProps) {
	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const sendPrompt = useSendAgentPrompt();

	// 合并成单个选择器，使用 useShallow 避免无限循环
	const { messages, isStreaming, streamContent, error } = useAgentStore(
		useShallow((s) => ({
			messages: s.sessions[sessionId]?.messages,
			isStreaming: s.sessions[sessionId]?.isStreaming,
			streamContent: s.sessions[sessionId]?.streamContent,
			error: s.sessions[sessionId]?.error,
		})),
	);

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
						placeholder={m.agentChatPlaceholder()}
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
