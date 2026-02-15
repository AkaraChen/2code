import {
	Blockquote,
	Box,
	Button,
	Code,
	CodeBlock,
	Flex,
	Heading,
	HStack,
	Link,
	List,
	Spinner,
	Table,
	Text,
	Textarea,
	createShikiAdapter,
} from "@chakra-ui/react";
import type { ComponentPropsWithoutRef } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { RiSendPlaneLine } from "react-icons/ri";
import type { HighlighterGeneric } from "shiki";
import { Streamdown } from "streamdown";
import { useShallow } from "zustand/react/shallow";
import * as m from "@/paraglide/messages.js";
import { useSendAgentPrompt } from "./hooks";
import type { AgentMessage } from "./store";
import { useAgentStore } from "./store";

// Shiki 适配器
const shikiAdapter = createShikiAdapter<HighlighterGeneric<any, any>>({
	async load() {
		const { createHighlighter } = await import("shiki");
		return createHighlighter({
			langs: ["typescript", "javascript", "python", "rust", "go", "bash", "json", "html", "css", "markdown", "tsx", "jsx"],
			themes: ["github-dark", "github-light"],
		});
	},
	theme: {
		light: "github-light",
		dark: "github-dark",
	},
});

// Streamdown 自定义组件映射（使用 Chakra UI 组件）
const streamdownComponents = {
	// 标题
	h1: (props: ComponentPropsWithoutRef<"h1">) => (
		<Heading as="h1" size="2xl" mt="6" mb="4" {...props} />
	),
	h2: (props: ComponentPropsWithoutRef<"h2">) => (
		<Heading as="h2" size="xl" mt="5" mb="3" {...props} />
	),
	h3: (props: ComponentPropsWithoutRef<"h3">) => (
		<Heading as="h3" size="lg" mt="4" mb="2" {...props} />
	),
	h4: (props: ComponentPropsWithoutRef<"h4">) => (
		<Heading as="h4" size="md" mt="4" mb="2" {...props} />
	),
	h5: (props: ComponentPropsWithoutRef<"h5">) => (
		<Heading as="h5" size="sm" mt="3" mb="2" {...props} />
	),
	h6: (props: ComponentPropsWithoutRef<"h6">) => (
		<Heading as="h6" size="xs" mt="3" mb="2" {...props} />
	),
	// 段落
	p: (props: ComponentPropsWithoutRef<"p">) => <Text my="3" {...props} />,
	// 行内代码
	code: (props: ComponentPropsWithoutRef<"code">) => {
		// 如果在 pre 标签内，不做处理（由 pre 渲染）
		if (props.className?.includes("language-")) {
			return <code {...props} />;
		}
		// 行内代码使用 Chakra UI Code 组件
		return <Code fontSize="0.9em" px="1" {...props} />;
	},
	// 代码块（使用 Chakra UI CodeBlock + Shiki）
	pre: ({ children }: ComponentPropsWithoutRef<"pre">) => {
		const codeElement = (children as any)?.props;
		const className = codeElement?.className || "";
		const language = className.replace("language-", "") || "text";
		const code = typeof codeElement?.children === "string" ? codeElement.children.trim() : "";

		if (!code) {
			return (
				<Box
					as="pre"
					bg="bg.muted"
					borderRadius="md"
					p="4"
					my="4"
					overflow="auto"
					textStyle="sm"
				>
					{children}
				</Box>
			);
		}

		return (
			<CodeBlock.Root code={code} language={language} my="4">
				<CodeBlock.Content>
					<CodeBlock.Code>
						<CodeBlock.CodeText />
					</CodeBlock.Code>
				</CodeBlock.Content>
			</CodeBlock.Root>
		);
	},
	// 引用块
	blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
		<Blockquote.Root my="4" {...props}>
			<Blockquote.Content>{props.children}</Blockquote.Content>
		</Blockquote.Root>
	),
	// 链接
	a: (props: ComponentPropsWithoutRef<"a">) => <Link {...props} />,
	// 列表
	ul: (props: ComponentPropsWithoutRef<"ul">) => (
		<List.Root as="ul" my="3" ps="6" {...props} />
	),
	ol: (props: ComponentPropsWithoutRef<"ol">) => (
		<List.Root as="ol" my="3" ps="6" {...props} />
	),
	li: (props: ComponentPropsWithoutRef<"li">) => (
		<List.Item my="1" {...props} />
	),
	// 分隔线
	hr: (props: ComponentPropsWithoutRef<"hr">) => (
		<Box as="hr" my="6" borderColor="border" {...props} />
	),
	// 强调
	strong: (props: ComponentPropsWithoutRef<"strong">) => (
		<Box as="strong" fontWeight="semibold" {...props} />
	),
	em: (props: ComponentPropsWithoutRef<"em">) => (
		<Box as="em" fontStyle="italic" {...props} />
	),
	// 表格
	table: (props: ComponentPropsWithoutRef<"table">) => (
		<Table.Root size="sm" variant="outline" my="4" {...props} />
	),
	thead: (props: ComponentPropsWithoutRef<"thead">) => (
		<Table.Header {...props} />
	),
	tbody: (props: ComponentPropsWithoutRef<"tbody">) => (
		<Table.Body {...props} />
	),
	tr: (props: ComponentPropsWithoutRef<"tr">) => <Table.Row {...props} />,
	th: (props: ComponentPropsWithoutRef<"th">) => (
		<Table.ColumnHeader {...props} />
	),
	td: (props: ComponentPropsWithoutRef<"td">) => <Table.Cell {...props} />,
};

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
				<CodeBlock.AdapterProvider value={shikiAdapter}>
					<Streamdown animated isAnimating={false} components={streamdownComponents}>
						{message.content}
					</Streamdown>
				</CodeBlock.AdapterProvider>
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
				<CodeBlock.AdapterProvider value={shikiAdapter}>
					<Streamdown animated isAnimating={true} components={streamdownComponents}>
						{content}
					</Streamdown>
				</CodeBlock.AdapterProvider>
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
