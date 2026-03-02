import consola from "consola";
import { match } from "ts-pattern";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import type {
	AgentSessionState,
	StreamingTurn,
	AgentMessageContent,
	ToolCall,
	ToolCallUpdate,
} from "../types";

export function ensureSession(
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

export function flushStreamingTurn(turn: StreamingTurn): AgentMessageContent[] {
	return [...turn.agentContent];
}

/**
 * Merge a ToolCallUpdate into an existing ToolCall
 */
export function mergeToolCallUpdate(
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
export function applySessionUpdate(
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
export function replayAgentEvent(streamingTurn: StreamingTurn, payload: unknown) {
	if (typeof payload !== "object" || payload === null) return;

	const obj = payload as Record<string, unknown>;

	if (obj.method === "session/update" && obj.params) {
		const params = obj.params as SessionNotification;
		applySessionUpdate(streamingTurn, params.update);
	}
}
