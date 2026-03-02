import type {
	AgentNotification,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import consola from "consola";
import type { StateCreator } from "zustand";
import type { AgentStore } from "../store";
import { applySessionUpdate, ensureSession, flushStreamingTurn } from "./utils";

export interface MessageSlice {
	addUserMessage: (sessionId: string, content: string) => void;
	setStreaming: (sessionId: string, streaming: boolean) => void;
	handleAgentEvent: (sessionId: string, payload: AgentNotification) => void;
	handleTurnComplete: (sessionId: string, payload: unknown) => void;
	handleError: (sessionId: string, error: string) => void;
}

export const createMessageSlice: StateCreator<
	AgentStore,
	[["zustand/immer", never]],
	[],
	MessageSlice
> = (set) => ({
	addUserMessage: (sessionId, content) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);

			session.streamingTurn = {
				userMessage: content,
				agentContent: [],
			};
		}),

	setStreaming: (sessionId, streaming) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);
			session.isStreaming = streaming;
		}),

	handleAgentEvent: (sessionId, payload) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);

			if (!session.streamingTurn) {
				consola.warn(
					`[AgentStore] Received agent event but no streamingTurn exists for ${sessionId}`,
				);
				return;
			}

			const streamingTurn = session.streamingTurn;

			if (payload.method === "session/update" && payload.params) {
				const { update } = payload.params as SessionNotification;
				applySessionUpdate(streamingTurn, update);
			}
		}),

	handleTurnComplete: (sessionId, _payload) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);

			if (!session.streamingTurn) {
				consola.warn(
					`[AgentStore] Turn complete but no streamingTurn for ${sessionId}`,
				);
				return;
			}

			const streamingTurn = session.streamingTurn;
			const agentContent = flushStreamingTurn(streamingTurn);

			session.turns.push({
				timestamp: Date.now(),
				userMessage: streamingTurn.userMessage,
				agentContent,
			});

			session.streamingTurn = null;
			session.isStreaming = false;
			session.error = null;
		}),

	handleError: (sessionId, error) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);
			session.isStreaming = false;
			session.error = error;

			if (session.streamingTurn) {
				const streamingTurn = session.streamingTurn;
				const agentContent = flushStreamingTurn(streamingTurn);

				const textIdx = agentContent.findIndex(
					(c) => c.type === "text",
				);
				if (textIdx >= 0) {
					const textItem = agentContent[textIdx] as {
						type: "text";
						text: string;
						role: string;
					};
					textItem.text = `${textItem.text}\n\n[Error: ${error}]`;
				} else {
					agentContent.unshift({
						type: "text",
						text: `[Error: ${error}]`,
						role: "assistant",
					});
				}

				for (const item of agentContent) {
					if (item.type === "tool_call") {
						const tc = item.data;
						if (
							tc.status === "pending" ||
							tc.status === "in_progress"
						) {
							item.data = { ...tc, status: "failed" };
						}
					}
				}

				session.turns.push({
					timestamp: Date.now(),
					userMessage: streamingTurn.userMessage,
					agentContent,
				});

				session.streamingTurn = null;
			}
		}),
});
