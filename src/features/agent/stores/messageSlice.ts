import type {
	AgentNotification,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import { match, P } from "ts-pattern";
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

			match(payload)
				.with(
					{
						method: "session/update",
						params: {
							update: {
								sessionUpdate: "current_mode_update",
								modeId: P.string,
							},
						},
					},
					(payload) => {
						if (session.modeState) {
							session.modeState.current_mode_id =
								payload.params.update.modeId;
						}
					},
				)
				.with({ method: "session/update", params: P._ }, (payload) => {
					if (session.streamingTurn && payload.params) {
						applySessionUpdate(
							session.streamingTurn,
							(payload.params as SessionNotification).update,
						);
					}
				})
				.otherwise(() => {
					// Unhandled notification types are ignored
				});
		}),

	handleTurnComplete: (sessionId, _payload) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);

			match(session.streamingTurn)
				.with(null, () => {
					// No streaming turn to finalize
				})
				.otherwise((streamingTurn) => {
					const agentContent = flushStreamingTurn(streamingTurn);

					session.turns.push({
						timestamp: Date.now(),
						userMessage: streamingTurn.userMessage,
						agentContent,
					});

					session.streamingTurn = null;
					session.isStreaming = false;
					session.error = null;
				});
		}),

	handleError: (sessionId, error) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);

			match(session.streamingTurn)
				.with(null, () => {
					session.isStreaming = false;
					session.error = error;
				})
				.otherwise((streamingTurn) => {
					const agentContent = flushStreamingTurn(streamingTurn);

					// Append error to existing text or create new text entry
					const textEntry = agentContent.find(
						(c) => c.type === "text",
					);
					if (textEntry?.type === "text") {
						textEntry.text += `\n\n[Error: ${error}]`;
					} else {
						agentContent.unshift({
							type: "text",
							text: `[Error: ${error}]`,
							role: "assistant",
						});
					}

					// Mark pending tool calls as failed
					for (const item of agentContent) {
						if (item.type === "tool_call") {
							match(item.data.status)
								.with("pending", "in_progress", () => {
									item.data = {
										...item.data,
										status: "failed",
									};
								})
								.otherwise(() => {
									// Other statuses remain unchanged
								});
						}
					}

					session.turns.push({
						timestamp: Date.now(),
						userMessage: streamingTurn.userMessage,
						agentContent,
					});

					session.streamingTurn = null;
					session.isStreaming = false;
					session.error = error;
				});
		}),
});
