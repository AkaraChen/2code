import { Box, Flex, HStack, IconButton, Spinner, Text, VStack } from "@chakra-ui/react";
import { Suspense, use, useCallback, useState } from "react";
import { LuShrink } from "react-icons/lu";
import { ErrorBoundary } from "react-error-boundary";
import { useShallow } from "zustand/react/shallow";
import type { AgentTabSession } from "@/features/tabs/AgentTabSession";
import { sessionRegistry } from "@/features/tabs/sessionRegistry";
import * as m from "@/paraglide/messages.js";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";
import { useSendAgentPrompt } from "./hooks";
import { useAgentStore } from "./store";

interface AgentChatProps {
	sessionId: string;
	isActive: boolean;
}

/** Deduplicates concurrent reconnection attempts per session. */
const reconnectCache = new Map<string, Promise<void>>();

function getReconnectPromise(sessionId: string): Promise<void> {
	const cached = reconnectCache.get(sessionId);
	if (cached) return cached;

	const tabSession = sessionRegistry.get(sessionId) as AgentTabSession;
	const promise = tabSession.reconnect().then(
		() => { reconnectCache.delete(sessionId); },
		(err) => {
			reconnectCache.delete(sessionId);
			throw err;
		},
	);
	reconnectCache.set(sessionId, promise);
	return promise;
}

function needsReconnection(sessionId: string): boolean {
	if (useAgentStore.getState().sessions[sessionId]) return false;
	const tabSession = sessionRegistry.get(sessionId);
	return (
		!!tabSession &&
		tabSession.type === "agent" &&
		!(tabSession as AgentTabSession).connected
	);
}

function AwaitReconnection({ sessionId }: { sessionId: string }) {
	use(getReconnectPromise(sessionId));
	return null;
}

function ReconnectingFallback() {
	return (
		<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
			<VStack gap="4">
				<Spinner size="lg" />
				<Text color="fg.muted">{m.agentReconnecting()}</Text>
			</VStack>
		</Flex>
	);
}

function ReconnectErrorFallback({ error }: { error: unknown }) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
			<VStack gap="4">
				<Text color="fg.error">
					{m.agentReconnectFailed({ error: message })}
				</Text>
			</VStack>
		</Flex>
	);
}

export function AgentChat({ sessionId, isActive }: AgentChatProps) {
	const sendPrompt = useSendAgentPrompt();

	const { turns, isStreaming, streamingTurn, error } = useAgentStore(
		useShallow((s) => {
			const session = s.sessions[sessionId];
			return {
				turns: session?.turns,
				isStreaming: session?.isStreaming,
				streamingTurn: session?.streamingTurn,
				error: session?.error,
			};
		}),
	);

	const [expanded, setExpanded] = useState(false);

	const handleSend = useCallback(
		(content: string) => sendPrompt.mutate({ sessionId, content }),
		[sendPrompt, sessionId],
	);

	if (isActive && needsReconnection(sessionId)) {
		return (
			<ErrorBoundary FallbackComponent={ReconnectErrorFallback}>
				<Suspense fallback={<ReconnectingFallback />}>
					<AwaitReconnection sessionId={sessionId} />
				</Suspense>
			</ErrorBoundary>
		);
	}

	return (
		<Flex direction="column" h="full" w="full" bg="bg" position="relative">
			<MessageList
				turns={turns}
				isStreaming={isStreaming ?? false}
				streamingTurn={streamingTurn}
				error={error ?? undefined}
			/>

			{/* Compact floating card */}
			{!expanded && (
				<>
					<Box h="20" flexShrink={0} aria-hidden="true" />
					<Box position="absolute" bottom="0" left="0" right="0" px="3" pb="3">
						<Box maxW="2xl" mx="auto">
							<ChatInput
								onSend={handleSend}
								disabled={isStreaming ?? false}
								onToggleExpand={() => setExpanded(true)}
							/>
						</Box>
					</Box>
				</>
			)}

			{/* Sheet panel */}
			{expanded && (
				<Flex
					position="absolute"
					bottom="0"
					left="0"
					right="0"
					h="50vh"
					direction="column"
					bg="bg"
					borderTopWidth="1px"
					overflow="hidden"
				>
					<HStack px="3" h="10" flexShrink={0} justify="flex-end">
						<IconButton
							size="sm"
							variant="ghost"
							onClick={() => setExpanded(false)}
							aria-label="Collapse"
						>
							<LuShrink />
						</IconButton>
					</HStack>
					<Box flex="1" overflow="hidden">
						<ChatInput
							onSend={handleSend}
							disabled={isStreaming ?? false}
							expanded={true}
						/>
					</Box>
				</Flex>
			)}
		</Flex>
	);
}
