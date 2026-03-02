/**
 * ACP (Agent Communication Protocol) message type definitions
 * Re-exports SDK types and adds application-layer specific types
 */

// ==================== Re-exported core types from SDK ====================

export type {
	ToolCallStatus,
	ToolCallLocation,
	ToolCallContent,
	ToolCall,
	ToolCallUpdate,
	Plan,
} from "@agentclientprotocol/sdk";

// ==================== Application-layer specific types ====================

import type { ToolCall, Plan } from "@agentclientprotocol/sdk";

/**
 * Unified message content type (used for UI rendering)
 */
export type AgentMessageContent =
	| { type: "text"; text: string; role: "user" | "assistant" }
	| { type: "thought"; text: string }
	| { type: "tool_call"; data: ToolCall }
	| { type: "plan"; data: Plan };

/**
 * Turn structure - a complete conversation turn
 */
export interface AgentTurn {
	timestamp: number;
	userMessage: string;
	agentContent: AgentMessageContent[];
}

/**
 * Streaming accumulator - uses the same content model as completed turns.
 * Events are appended in arrival order; text/thought chunks are concatenated
 * onto the matching tail entry of the array.
 */
export interface StreamingTurn {
	userMessage: string;
	agentContent: AgentMessageContent[];
}

import type { AgentModelState } from "@/generated";

export interface AgentSessionState {
	turns: AgentTurn[];
	isStreaming: boolean;
	streamingTurn: StreamingTurn | null;
	error: string | null;
	modelState: AgentModelState | null;
	modelLoading: boolean;
}
