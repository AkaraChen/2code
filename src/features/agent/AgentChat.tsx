import { Flex, Spinner, Text, VStack } from "@chakra-ui/react";
import { Suspense, use, useCallback } from "react";
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

/**
 * Suspends until reconnection completes.
 * After resolve, reconnect() has already called replaceTab(),
 * so the parent re-renders with the new sessionId and this component unmounts.
 */
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

	const handleSend = useCallback(
		(content: string) => sendPrompt.mutate({ sessionId, content }),
		[sendPrompt, sessionId],
	);

	// Lazy reconnection: suspend when tab is focused and needs reconnecting
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
		<Flex direction="column" h="full" w="full" bg="bg">
			<MessageList
				turns={turns}
				isStreaming={isStreaming ?? false}
				streamingTurn={streamingTurn}
				error={error ?? undefined}
			/>
			<ChatInput onSend={handleSend} disabled={isStreaming ?? false} />
		</Flex>
	);
}
