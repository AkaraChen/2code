import { Flex, Spinner, Text, VStack } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { sessionRegistry } from "@/features/tabs/sessionRegistry";
import { AgentTabSession } from "@/features/tabs/AgentTabSession";
import { useSendAgentPrompt } from "./hooks";
import { useAgentStore } from "./store";
import { ChatInput } from "./components/ChatInput";
import { MessageList } from "./components/MessageList";

interface AgentChatProps {
	sessionId: string;
	isActive: boolean;
}

/**
 * Agent 聊天界面主容器
 * 组合消息列表和输入框,管理发送逻辑
 *
 * On mount, if the session store has no data for this sessionId,
 * it means we're restoring from a previous run — trigger lazy reconnection.
 */
export function AgentChat({ sessionId, isActive }: AgentChatProps) {
	const sendPrompt = useSendAgentPrompt();
	const [reconnecting, setReconnecting] = useState(false);
	const [reconnectError, setReconnectError] = useState<string | null>(null);
	// Track the effective session ID (changes after reconnect swaps old → new)
	const [effectiveId, setEffectiveId] = useState(sessionId);

	const { turns, isStreaming, streamingTurn, error } = useAgentStore(
		useShallow((s) => {
			const session = s.sessions[effectiveId];
			return {
				turns: session?.turns,
				isStreaming: session?.isStreaming,
				streamingTurn: session?.streamingTurn,
				error: session?.error,
			};
		}),
	);

	// Lazy reconnection: only when this tab is focused and store has no session data
	useEffect(() => {
		if (!isActive) return;

		const session = useAgentStore.getState().sessions[sessionId];
		if (session) return; // Already connected/initialized

		const tabSession = sessionRegistry.get(sessionId);
		if (
			!tabSession ||
			tabSession.type !== "agent" ||
			(tabSession as AgentTabSession).connected
		) {
			return;
		}

		const agentSession = tabSession as AgentTabSession;
		setReconnecting(true);
		setReconnectError(null);

		agentSession
			.reconnect()
			.then((newSession) => {
				setEffectiveId(newSession.id);
				setReconnecting(false);
			})
			.catch((e) => {
				setReconnecting(false);
				setReconnectError(
					e instanceof Error ? e.message : String(e),
				);
			});
	}, [sessionId, isActive]);

	const handleSend = useCallback(
		(content: string) => {
			sendPrompt.mutate({ sessionId: effectiveId, content });
		},
		[sendPrompt, effectiveId],
	);

	if (reconnecting) {
		return (
			<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
				<VStack gap="4">
					<Spinner size="lg" />
					<Text color="fg.muted">{m.agentReconnecting()}</Text>
				</VStack>
			</Flex>
		);
	}

	if (reconnectError) {
		return (
			<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
				<VStack gap="4">
					<Text color="fg.error">{m.agentReconnectFailed({ error: reconnectError })}</Text>
				</VStack>
			</Flex>
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
