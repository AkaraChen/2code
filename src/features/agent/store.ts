import type {
	AgentNotification,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import consola from "consola";
import { match } from "ts-pattern";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AgentSessionEventRecord } from "@/generated";
import type {
	AgentTurn,
	StreamingTurn,
	ToolCall,
	ToolCallUpdate,
	AgentMessageContent,
} from "./types";

// 保留旧的 AgentMessage 类型用于向后兼容
export interface AgentMessage {
	role: "user" | "assistant";
	content: string;
	timestamp: number;
}

interface AgentSessionState {
	turns: AgentTurn[];
	isStreaming: boolean;
	streamingTurn: StreamingTurn | null;
	error: string | null;
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

				// 初始化一个新的 streamingTurn
				session.streamingTurn = {
					userMessage: content,
					textChunks: [],
					thoughtChunks: [],
					toolCalls: new Map(),
					plan: null,
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

				// 确保有 streamingTurn（防御性编程）
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

				// 将累积的内容转换为 AgentMessageContent 数组
				const agentContent: AgentMessageContent[] = [];

				// 文本消息
				if (streamingTurn.textChunks.length > 0) {
					agentContent.push({
						type: "text",
						text: streamingTurn.textChunks.join(""),
						role: "assistant",
					});
				}

				// 思考块
				if (streamingTurn.thoughtChunks.length > 0) {
					agentContent.push({
						type: "thought",
						text: streamingTurn.thoughtChunks.join(""),
					});
				}

				// 工具调用
				for (const toolCall of streamingTurn.toolCalls.values()) {
					agentContent.push({
						type: "tool_call",
						data: toolCall,
					});
				}

				// 计划
				if (streamingTurn.plan) {
					agentContent.push({
						type: "plan",
						data: streamingTurn.plan,
					});
				}

				// 创建完整的 turn
				session.turns.push({
					timestamp: Date.now(),
					userMessage: streamingTurn.userMessage,
					agentContent,
				});

				// 清理
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

				// 如果有部分内容，仍然保存（但标记错误）
				if (session.streamingTurn) {
					const streamingTurn = session.streamingTurn;
					const agentContent: AgentMessageContent[] = [];

					// 保存已收到的文本（带错误标记）
					if (streamingTurn.textChunks.length > 0) {
						agentContent.push({
							type: "text",
							text: `${streamingTurn.textChunks.join("")}\n\n[Error: ${error}]`,
							role: "assistant",
						});
					} else {
						// 如果没有内容，只显示错误
						agentContent.push({
							type: "text",
							text: `[Error: ${error}]`,
							role: "assistant",
						});
					}

					// 保存其他已收到的内容
					if (streamingTurn.thoughtChunks.length > 0) {
						agentContent.push({
							type: "thought",
							text: streamingTurn.thoughtChunks.join(""),
						});
					}

					for (const toolCall of streamingTurn.toolCalls.values()) {
						// 将不完整的工具调用标记为 failed
						agentContent.push({
							type: "tool_call",
							data: {
								...toolCall,
								status:
									toolCall.status === "pending" ||
									toolCall.status === "in_progress"
										? "failed"
										: toolCall.status,
							},
						});
					}

					if (streamingTurn.plan) {
						agentContent.push({
							type: "plan",
							data: streamingTurn.plan,
						});
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

					// 重放所有 agent 事件来重建内容
					const tempStreamingTurn: StreamingTurn = {
						userMessage,
						textChunks: [],
						thoughtChunks: [],
						toolCalls: new Map(),
						plan: null,
					};

					const agentEvents = turnEvents
						.filter((e) => e.sender === "agent")
						.sort((a, b) => a.event_index - b.event_index);

					for (const event of agentEvents) {
						try {
							const payload = JSON.parse(
								event.payload_json,
							);
							// 重放事件处理逻辑
							replayAgentEvent(tempStreamingTurn, payload);
						} catch (err) {
							consola.warn(
								`Failed to parse agent event ${event.id}:`,
								err,
							);
						}
					}

					// 刷新为完整的 turn
					const agentContent: AgentMessageContent[] = [];

					if (tempStreamingTurn.textChunks.length > 0) {
						agentContent.push({
							type: "text",
							text: tempStreamingTurn.textChunks.join(""),
							role: "assistant",
						});
					}

					if (tempStreamingTurn.thoughtChunks.length > 0) {
						agentContent.push({
							type: "thought",
							text: tempStreamingTurn.thoughtChunks.join(""),
						});
					}

					for (const toolCall of tempStreamingTurn.toolCalls.values()) {
						agentContent.push({
							type: "tool_call",
							data: toolCall,
						});
					}

					if (tempStreamingTurn.plan) {
						agentContent.push({
							type: "plan",
							data: tempStreamingTurn.plan,
						});
					}

					// 只有在有内容时才创建 turn
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
 * 合并 ToolCallUpdate 到现有的 ToolCall
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
 */
function applySessionUpdate(
	streamingTurn: StreamingTurn,
	update: SessionNotification["update"],
) {
	match(update)
		.with(
			{ sessionUpdate: "agent_message_chunk", content: { type: "text" } },
			(u) => {
				streamingTurn.textChunks.push(u.content.text);
			},
		)
		.with(
			{ sessionUpdate: "agent_thought_chunk", content: { type: "text" } },
			(u) => {
				streamingTurn.thoughtChunks.push(u.content.text);
			},
		)
		.with({ sessionUpdate: "tool_call" }, (u) => {
			const toolCall = u as unknown as ToolCall;
			streamingTurn.toolCalls.set(toolCall.toolCallId, toolCall);
		})
		.with({ sessionUpdate: "tool_call_update" }, (u) => {
			const toolCallUpdate = u as unknown as ToolCallUpdate;
			const existing = streamingTurn.toolCalls.get(
				toolCallUpdate.toolCallId,
			);
			if (existing) {
				streamingTurn.toolCalls.set(
					toolCallUpdate.toolCallId,
					mergeToolCallUpdate(existing, toolCallUpdate),
				);
			} else {
				streamingTurn.toolCalls.set(toolCallUpdate.toolCallId, {
					toolCallId: toolCallUpdate.toolCallId,
					title: toolCallUpdate.title ?? "Tool Call",
					status: toolCallUpdate.status ?? "pending",
					kind: toolCallUpdate.kind ?? undefined,
					rawInput: toolCallUpdate.rawInput,
					rawOutput: toolCallUpdate.rawOutput,
					content: toolCallUpdate.content ?? undefined,
					locations: toolCallUpdate.locations ?? undefined,
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
			streamingTurn.plan = plan;
		})
		.otherwise(() => {});
}

/**
 * 重放 agent 事件到 StreamingTurn（用于恢复）
 */
function replayAgentEvent(streamingTurn: StreamingTurn, payload: unknown) {
	if (typeof payload !== "object" || payload === null) return;

	const obj = payload as Record<string, unknown>;

	if (obj.method === "session/update" && obj.params) {
		const params = obj.params as SessionNotification;
		applySessionUpdate(streamingTurn, params.update);
	}
}
