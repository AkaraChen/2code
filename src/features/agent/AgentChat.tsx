import {
	Blockquote,
	Box,
	Button,
	Code,
	CodeBlock,
	createShikiAdapter,
	Flex,
	Heading,
	HStack,
	Link,
	List,
	Spinner,
	Table,
	Text,
	Textarea,
} from "@chakra-ui/react";
import { open } from "@tauri-apps/plugin-shell";
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

const SHIKI_LANGS = [
	"typescript",
	"javascript",
	"python",
	"rust",
	"go",
	"bash",
	"json",
	"html",
	"css",
	"markdown",
	"tsx",
	"jsx",
] as const;

const shikiAdapter = createShikiAdapter<HighlighterGeneric<any, any>>({
	async load() {
		const { createHighlighter } = await import("shiki");
		return createHighlighter({
			langs: [...SHIKI_LANGS],
			themes: ["github-dark", "github-light"],
		});
	},
	theme: { light: "github-light", dark: "github-dark" },
});

function openExternalLink(href: string | undefined): void {
	if (!href) return;
	open(href).catch((err) => console.error("Failed to open link:", err));
}

const streamdownComponents = {
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
	p: (props: ComponentPropsWithoutRef<"p">) => <Text my="3" {...props} />,
	code: (props: ComponentPropsWithoutRef<"code">) => {
		if (props.className?.includes("language-")) {
			return <code {...props} />;
		}
		return <Code fontSize="0.9em" px="1" {...props} />;
	},
	pre: ({ children }: ComponentPropsWithoutRef<"pre">) => {
		const codeElement = (children as any)?.props;
		const className = codeElement?.className || "";
		const language = className.replace("language-", "") || "text";
		const code =
			typeof codeElement?.children === "string"
				? codeElement.children.trim()
				: "";

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
	blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
		<Blockquote.Root my="4" {...props}>
			<Blockquote.Content>{props.children}</Blockquote.Content>
		</Blockquote.Root>
	),
	a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => (
		<Link
			{...props}
			onClick={(e) => {
				e.preventDefault();
				openExternalLink(href);
			}}
			color="blue.500"
			textDecoration="underline"
			cursor="pointer"
		>
			{children}
		</Link>
	),
	ul: (props: ComponentPropsWithoutRef<"ul">) => (
		<List.Root as="ul" my="3" ps="6" {...props} />
	),
	ol: (props: ComponentPropsWithoutRef<"ol">) => (
		<List.Root as="ol" my="3" ps="6" {...props} />
	),
	li: (props: ComponentPropsWithoutRef<"li">) => (
		<List.Item my="1" {...props} />
	),
	hr: (props: ComponentPropsWithoutRef<"hr">) => (
		<Box as="hr" my="6" borderColor="border" {...props} />
	),
	strong: (props: ComponentPropsWithoutRef<"strong">) => (
		<Box as="strong" fontWeight="semibold" {...props} />
	),
	em: (props: ComponentPropsWithoutRef<"em">) => (
		<Box as="em" fontStyle="italic" {...props} />
	),
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

interface BubbleProps {
	content: string;
	align?: "flex-start" | "flex-end";
	bg?: string;
	isAnimating?: boolean;
	children?: React.ReactNode;
}

function ChatBubble({
	content,
	align = "flex-start",
	bg = "bg.muted",
	isAnimating = false,
	children,
}: BubbleProps) {
	return (
		<Flex justify={align} w="full">
			<Box
				maxW="80%"
				px="4"
				py="2"
				borderRadius="lg"
				bg={bg}
				fontSize="sm"
				overflow="auto"
			>
				<CodeBlock.AdapterProvider value={shikiAdapter}>
					<Streamdown
						animated
						isAnimating={isAnimating}
						components={streamdownComponents}
					>
						{content}
					</Streamdown>
				</CodeBlock.AdapterProvider>
				{children}
			</Box>
		</Flex>
	);
}

function MessageBubble({ message }: { message: AgentMessage }) {
	const isUser = message.role === "user";
	return (
		<ChatBubble
			content={message.content}
			align={isUser ? "flex-end" : "flex-start"}
			bg={isUser ? "colorPalette.subtle" : "bg.muted"}
		/>
	);
}

function StreamingBubble({ content }: { content: string }) {
	if (!content) return null;
	return (
		<ChatBubble content={content} isAnimating>
			<Spinner size="xs" ml="2" />
		</ChatBubble>
	);
}

interface AgentChatProps {
	sessionId: string;
}

export function AgentChat({ sessionId }: AgentChatProps) {
	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const sendPrompt = useSendAgentPrompt();

	const { messages, isStreaming, streamContent, error } = useAgentStore(
		useShallow((s) => {
			const session = s.sessions[sessionId];
			return {
				messages: session?.messages,
				isStreaming: session?.isStreaming,
				streamContent: session?.streamContent,
				error: session?.error,
			};
		}),
	);

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
					{isStreaming && (
						<StreamingBubble content={streamContent ?? ""} />
					)}
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
