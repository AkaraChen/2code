import type {
	AgentNotification,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import consola from "consola";
import { match } from "ts-pattern";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AgentModelState, AgentSessionEventRecord } from "@/generated";
import type {
	AgentTurn,
	StreamingTurn,
	ToolCall,
	ToolCallUpdate,
	AgentMessageContent,
} from "./types";

interface AgentSessionState {
	turns: AgentTurn[];
	isStreaming: boolean;
	streamingTurn: StreamingTurn | null;
	error: string | null;
	modelState: AgentModelState | null;
	modelLoading: boolean;
}

interface AgentStore {
	sessions: Record<string, AgentSessionState>;
	initSession: (sessionId: string) => void;
	removeSession: (sessionId: string) => void;
	addUserMessage: (sessionId: string, content: string) => void;
	setStreaming: (sessionId: string, streaming: boolean) => void;
	handleAgentEvent: (sessionId: string, payload: AgentNotification) => void;
	handleTurnComplete: (sessionId: string, payload: unknown) => void;
	handleError: (sessionId: string, error: string) => void;
	setModelState: (sessionId: string, modelState: AgentModelState | null) => void;
	setModelLoading: (sessionId: string, loading: boolean) => void;
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
			turns: [],
			isStreaming: false,
			streamingTurn: null,
			error: null,
			modelState: null,
			modelLoading: false,
		};
	}
	return sessions[sessionId];
}

function flushStreamingTurn(turn: StreamingTurn): AgentMessageContent[] {
	return [...turn.agentContent];
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

				session.streamingTurn = {
					userMessage: content,
					agentContent: [],
				};

				// Note: User message persistence is now handled by backend in send_agent_prompt
			});
		},

		setStreaming(sessionId, streaming) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.isStreaming = streaming;
			});
		},

		handleAgentEvent(sessionId, payload) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);

				// Ensure streamingTurn exists (defensive)
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
			});
		},

		handleTurnComplete(sessionId, _payload) {
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

				// Create completed turn
				session.turns.push({
					timestamp: Date.now(),
					userMessage: streamingTurn.userMessage,
					agentContent,
				});

				// Cleanup
				session.streamingTurn = null;
				session.isStreaming = false;
				session.error = null;
			});
		},

		handleError(sessionId, error) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.isStreaming = false;
				session.error = error;

				// If there is partial content, still save it (but mark the error)
				if (session.streamingTurn) {
					const streamingTurn = session.streamingTurn;
					const agentContent = flushStreamingTurn(streamingTurn);

					// Prepend or append error to text content
					const textIdx = agentContent.findIndex((c) => c.type === "text");
					if (textIdx >= 0) {
						const textItem = agentContent[textIdx] as { type: "text"; text: string; role: string };
						textItem.text = `${textItem.text}\n\n[Error: ${error}]`;
					} else {
						agentContent.unshift({
							type: "text",
							text: `[Error: ${error}]`,
							role: "assistant",
						});
					}

					// Mark incomplete tool calls as failed
					for (const item of agentContent) {
						if (item.type === "tool_call") {
							const tc = item.data;
							if (tc.status === "pending" || tc.status === "in_progress") {
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
			});
		},

		setModelState(sessionId, modelState) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.modelState = modelState;
			});
		},

		setModelLoading(sessionId, loading) {
			set((state) => {
				const session = ensureSession(state.sessions, sessionId);
				session.modelLoading = loading;
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

				let restoredTurns = 0;

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

					let userMessage = "";
					if (userEvent) {
						try {
							const payload = JSON.parse(
								userEvent.payload_json,
							);
							userMessage = payload.text || "";
						} catch (err) {
							consola.warn(
								`Failed to parse user event ${userEvent.id}:`,
								err,
							);
						}
					}

					// Replay all agent events to reconstruct content
					const tempStreamingTurn: StreamingTurn = {
						userMessage,
						agentContent: [],
					};

					const agentEvents = turnEvents
						.filter((e) => e.sender === "agent")
						.sort((a, b) => a.event_index - b.event_index);

					for (const event of agentEvents) {
						try {
							const payload = JSON.parse(
								event.payload_json,
							);
							// Replay event handling logic
							replayAgentEvent(tempStreamingTurn, payload);
						} catch (err) {
							consola.warn(
								`Failed to parse agent event ${event.id}:`,
								err,
							);
						}
					}

					const agentContent = flushStreamingTurn(tempStreamingTurn);

					// Only create a turn if there is content
					if (userMessage || agentContent.length > 0) {
						const timestamp = userEvent?.created_at
							? userEvent.created_at * 1000
							: agentEvents[agentEvents.length - 1]
									?.created_at * 1000 || Date.now();

						session.turns.push({
							timestamp,
							userMessage,
							agentContent,
						});
						restoredTurns++;
					}
				}

				consola.log(
					`[AgentStore] restored ${restoredTurns} turns from ${Object.keys(turnGroups).length} turn groups for ${sessionId}`,
				);
			});
		},
	})),
);

/**
 * Merge a ToolCallUpdate into an existing ToolCall
 */
function mergeToolCallUpdate(
	base: ToolCall,
	update: ToolCallUpdate,
): ToolCall {
	return {
		...base,
		...(update.title !== undefined && {
			title: update.title ?? base.title,
		}),
		...(update.kind !== undefined && { kind: update.kind ?? base.kind }),
		...(update.status !== undefined && {
			status: update.status ?? base.status,
		}),
		...(update.rawInput !== undefined && { rawInput: update.rawInput }),
		...(update.rawOutput !== undefined && { rawOutput: update.rawOutput }),
		...(update.content !== undefined && {
			content: update.content ?? base.content,
		}),
		...(update.locations !== undefined && {
			locations: update.locations ?? base.locations,
		}),
	};
}

/**
 * Apply a single session update to a StreamingTurn.
 * Shared between live event handling and replay-based restoration.
 * Content is appended in arrival order; text/thought chunks are concatenated
 * onto the matching tail entry of the array.
 */
function applySessionUpdate(
	streamingTurn: StreamingTurn,
	update: SessionNotification["update"],
) {
	const content = streamingTurn.agentContent;

	match(update)
		.with(
			{ sessionUpdate: "agent_message_chunk", content: { type: "text" } },
			(u) => {
				const last = content[content.length - 1];
				if (last && last.type === "text") {
					(last as { type: "text"; text: string; role: string }).text +=
						u.content.text;
				} else {
					content.push({
						type: "text",
						text: u.content.text,
						role: "assistant",
					});
				}
			},
		)
		.with(
			{ sessionUpdate: "agent_thought_chunk", content: { type: "text" } },
			(u) => {
				const last = content[content.length - 1];
				if (last && last.type === "thought") {
					(last as { type: "thought"; text: string }).text +=
						u.content.text;
				} else {
					content.push({
						type: "thought",
						text: u.content.text,
					});
				}
			},
		)
		.with({ sessionUpdate: "tool_call" }, (u) => {
			const toolCall = u as unknown as ToolCall;
			content.push({ type: "tool_call", data: toolCall });
		})
		.with({ sessionUpdate: "tool_call_update" }, (u) => {
			const toolCallUpdate = u as unknown as ToolCallUpdate;
			const existing = content.find(
				(item): item is { type: "tool_call"; data: ToolCall } =>
					item.type === "tool_call" &&
					item.data.toolCallId === toolCallUpdate.toolCallId,
			);
			if (existing) {
				existing.data = mergeToolCallUpdate(existing.data, toolCallUpdate);
			} else {
				content.push({
					type: "tool_call",
					data: {
						toolCallId: toolCallUpdate.toolCallId,
						title: toolCallUpdate.title ?? "Tool Call",
						status: toolCallUpdate.status ?? "pending",
						kind: toolCallUpdate.kind ?? undefined,
						rawInput: toolCallUpdate.rawInput,
						rawOutput: toolCallUpdate.rawOutput,
						content: toolCallUpdate.content ?? undefined,
						locations: toolCallUpdate.locations ?? undefined,
					},
				});
			}
		})
		.with({ sessionUpdate: "plan" }, (u) => {
			const plan = u as unknown as {
				entries: Array<{
					content: string;
					status: "pending" | "in_progress" | "completed";
					priority: "high" | "medium" | "low";
				}>;
			};
			const existingPlan = content.find(
				(item): item is { type: "plan"; data: typeof plan } =>
					item.type === "plan",
			);
			if (existingPlan) {
				existingPlan.data = plan;
			} else {
				content.push({ type: "plan", data: plan });
			}
		})
		.otherwise(() => {});
}

/**
 * Replay an agent event into a StreamingTurn (used for restoration)
 */
function replayAgentEvent(streamingTurn: StreamingTurn, payload: unknown) {
	if (typeof payload !== "object" || payload === null) return;

	const obj = payload as Record<string, unknown>;

	if (obj.method === "session/update" && obj.params) {
		const params = obj.params as SessionNotification;
		applySessionUpdate(streamingTurn, params.update);
	}
}
