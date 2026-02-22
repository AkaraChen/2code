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
 * Streaming accumulator - used to accumulate streaming updates
 */
export interface StreamingTurn {
	userMessage: string;
	textChunks: string[];
	thoughtChunks: string[];
	toolCalls: Map<string, ToolCall>;
	plan: Plan | null;
}
