import type {
	AgentNotification,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AgentSessionEventRecord } from "@/generated";
import consola from "consola";

export interface AgentMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

interface AgentSessionState {
	messages: AgentMessage[];
	isStreaming: boolean;
	streamContent: string;
	error: string | null;
}

interface AgentStore {
	sessions: Record<string, AgentSessionState>;
	initSession: (sessionId: string) => void;
	removeSession: (sessionId: string) => void;
	addUserMessage: (sessionId: string, content: string) => void;
	setStreaming: (sessionId: string, streaming: boolean) => void;
	appendStreamContent: (sessionId: string, content: string) => void;
	handleAgentEvent: (sessionId: string, payload: AgentNotification) => void;
	handleTurnComplete: (sessionId: string, payload: unknown) => void;
	handleError: (sessionId: string, error: string) => void;
	restoreFromEvents: (
		sessionId: string,
		events: AgentSessionEventRecord[],
	) => void;
}

function ensureSession(
	sessions: Record<string, AgentSessionState>,
	sessionId: string,
): AgentSessionState {
	if (!sessions[sessionId]) {
		sessions[sessionId] = {
			messages: [],
			isStreaming: false,
			streamContent: "",
			error: null,
		};
	}
	return sessions[sessionId];
}

export const useAgentStore = create<AgentStore>()(
	immer((set) => ({
		sessions: {},

		initSession(sessionId) {
			set((state) => {
				ensureSession(state.sessions, sessionId);
			});
		},

		removeSession(sessionId) {
			set((state) => {
				delete state.sessions[sessionId];
			});
		},

		addUserMessage(sessionId, content) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);

				session.messages.push({
					role: "user",
					content,
					timestamp: Date.now(),
				});

				// Note: User message persistence is now handled by backend in send_agent_prompt
			});
		},

		setStreaming(sessionId, streaming) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.isStreaming = streaming;
			});
		},

		appendStreamContent(sessionId, content) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.streamContent += content;
			});
		},

		handleAgentEvent(sessionId, payload) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);

				if (payload.method === "session/update" && payload.params) {
					const { update } = payload.params as SessionNotification;

					switch (update.sessionUpdate) {
						case "agent_message_chunk":
							if (update.content.type === "text") {
								session.streamContent += update.content.text;
							}
							break;
						case "agent_thought_chunk":
						case "tool_call":
						case "tool_call_update":
						case "plan":
							break;
					}
				}
			});
		},

		handleTurnComplete(sessionId, payload) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);

				// Extract messages from the prompt result
				const result = payload as Record<string, unknown>;
				const messages = result?.messages as
					| Array<Record<string, unknown>>
					| undefined;

				// If we have accumulated stream content, use that
				if (session.streamContent) {
					session.messages.push({
						role: "assistant",
						content: session.streamContent,
						timestamp: Date.now(),
					});
					session.streamContent = "";
				} else if (messages && messages.length > 0) {
					// Fall back to extracting from prompt result messages
					const textParts: string[] = [];
					for (const msg of messages) {
						const content = msg.content;
						if (typeof content === "string") {
							textParts.push(content);
						} else if (Array.isArray(content)) {
							for (const part of content) {
								if (
									typeof part === "object" &&
									part !== null &&
									"type" in part &&
									(part as { type: string }).type ===
										"text" &&
									"text" in part
								) {
									textParts.push(
										(part as { text: string }).text,
									);
								}
							}
						}
					}
					if (textParts.length > 0) {
						session.messages.push({
							role: "assistant",
							content: textParts.join("\n"),
							timestamp: Date.now(),
						});
					}
				}

				session.isStreaming = false;
				session.error = null;
			});
		},

		handleError(sessionId, error) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.isStreaming = false;
				session.error = error;
				// If there was partial stream content, still save it
				if (session.streamContent) {
					session.messages.push({
						role: "assistant",
						content: `${session.streamContent}\n\n[Error: ${error}]`,
						timestamp: Date.now(),
					});
					session.streamContent = "";
				}
			});
		},

		/**
		 * Restore session state from persisted events.
		 * Uses turn-based grouping to reconstruct conversation history.
		 * Each turn consists of a user message followed by agent response chunks.
		 */
		restoreFromEvents(sessionId, events) {
			consola.log(
				`[AgentStore] restoreFromEvents for ${sessionId}, ${events.length} events`,
			);

			set((state) => {
				const session = ensureSession(state.sessions, sessionId);

				// Group events by turn_index
				const turnGroups = events.reduce(
					(acc, event) => {
						const turnIdx = event.turn_index;
						if (!acc[turnIdx]) acc[turnIdx] = [];
						acc[turnIdx].push(event);
						return acc;
					},
					{} as Record<number, AgentSessionEventRecord[]>,
				);

				let restoredMessages = 0;

				// Process each turn in order
				for (const turnIdxStr of Object.keys(turnGroups).sort(
					(a, b) => Number(a) - Number(b),
				)) {
					const turnIdx = Number(turnIdxStr);
					const turnEvents = turnGroups[turnIdx];

					// Find user message (should be exactly one per turn)
					const userEvent = turnEvents.find(
						(e) => e.sender === "user",
					);
					if (userEvent) {
						try {
							const payload = JSON.parse(
								userEvent.payload_json,
							);
							if (payload.text) {
								session.messages.push({
									role: "user",
									content: payload.text,
									timestamp: userEvent.created_at * 1000,
								});
								restoredMessages++;
							}
						} catch (err) {
							consola.warn(
								`Failed to parse user event ${userEvent.id}:`,
								err,
							);
						}
					}

					// Find all agent events and merge chunks into one message
					const agentEvents = turnEvents
						.filter((e) => e.sender === "agent")
						.sort((a, b) => a.event_index - b.event_index);

					if (agentEvents.length > 0) {
						const chunks: string[] = [];
						for (const event of agentEvents) {
							try {
								const payload = JSON.parse(
									event.payload_json,
								);
								const content = extractAgentContent(payload);
								if (content) {
									chunks.push(content);
								}
							} catch (err) {
								consola.warn(
									`Failed to parse agent event ${event.id}:`,
									err,
								);
							}
						}

						if (chunks.length > 0) {
							session.messages.push({
								role: "assistant",
								content: chunks.join(""), // Merge all chunks
								timestamp:
									agentEvents[agentEvents.length - 1]
										.created_at * 1000,
							});
							restoredMessages++;
						}
					}
				}

				consola.log(
					`[AgentStore] restored ${restoredMessages} messages from ${Object.keys(turnGroups).length} turns for ${sessionId}`,
				);
			});
		},
	})),
);

/**
 * Extract readable text content from agent notification payload.
 * Agent events can be complex session updates with various formats.
 */
function extractAgentContent(payload: unknown): string | null {
	if (typeof payload !== "object" || payload === null) return null;

	const obj = payload as Record<string, unknown>;

	// Try to extract from session update
	if (obj.method === "session/update" && obj.params) {
		const params = obj.params as Record<string, unknown>;
		const update = params.update as Record<string, unknown> | undefined;

		if (update?.content && typeof update.content === "object") {
			const content = update.content as Record<string, unknown>;
			if (content.type === "text" && typeof content.text === "string") {
				return content.text;
			}
		}
	}

	// Fallback: if there's a direct text field
	if (typeof obj.text === "string") return obj.text;

	return null;
}
