import { Flex, Spinner, Text, VStack } from "@chakra-ui/react";
import { useCallback, useEffect, useReducer } from "react";
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

type ReconnectState = {
	effectiveId: string;
	reconnecting: boolean;
	error: string | null;
};

type ReconnectAction =
	| { type: "start" }
	| { type: "success"; id: string }
	| { type: "failure"; error: string };

function reconnectReducer(state: ReconnectState, action: ReconnectAction): ReconnectState {
	switch (action.type) {
		case "start":
			return { ...state, reconnecting: true, error: null };
		case "success":
			return { effectiveId: action.id, reconnecting: false, error: null };
		case "failure":
			return { ...state, reconnecting: false, error: action.error };
	}
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
	const [reconnect, dispatch] = useReducer(reconnectReducer, {
		effectiveId: sessionId,
		reconnecting: false,
		error: null,
	});

	const { turns, isStreaming, streamingTurn, error } = useAgentStore(
		useShallow((s) => {
			const session = s.sessions[reconnect.effectiveId];
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
		dispatch({ type: "start" });

		agentSession
			.reconnect()
			.then((newSession) => {
				dispatch({ type: "success", id: newSession.id });
			})
			.catch((e) => {
				dispatch({
					type: "failure",
					error: e instanceof Error ? e.message : String(e),
				});
			});
	}, [sessionId, isActive]);

	const handleSend = useCallback(
		(content: string) => {
			sendPrompt.mutate({ sessionId: reconnect.effectiveId, content });
		},
		[sendPrompt, reconnect.effectiveId],
	);

	if (reconnect.reconnecting) {
		return (
			<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
				<VStack gap="4">
					<Spinner size="lg" />
					<Text color="fg.muted">{m.agentReconnecting()}</Text>
				</VStack>
			</Flex>
		);
	}

	if (reconnect.error) {
		return (
			<Flex direction="column" h="full" w="full" align="center" justify="center" bg="bg">
				<VStack gap="4">
					<Text color="fg.error">{m.agentReconnectFailed({ error: reconnect.error })}</Text>
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
