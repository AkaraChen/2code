/**
 * ACP (Agent Communication Protocol) 消息类型定义
 * 重新导出 SDK 类型，并添加应用层特定类型
 */

// ==================== 从 SDK 重新导出核心类型 ====================

export type {
	ContentBlock,
	ToolKind,
	ToolCallStatus,
	ToolCallLocation,
	ToolCallContent,
	ToolCall,
	ToolCallUpdate,
	Plan,
	PlanEntry,
	PlanEntryStatus,
	PlanEntryPriority,
} from "@agentclientprotocol/sdk";

// ==================== 应用层特定类型 ====================

import type { ToolCall, Plan } from "@agentclientprotocol/sdk";

/**
 * 统一的消息内容类型（用于 UI 渲染）
 */
export type AgentMessageContent =
	| { type: "text"; text: string; role: "user" | "assistant" }
	| { type: "thought"; text: string }
	| { type: "tool_call"; data: ToolCall }
	| { type: "plan"; data: Plan };

/**
 * Turn 结构 - 一个完整的对话轮次
 */
export interface AgentTurn {
	timestamp: number;
	userMessage: string;
	agentContent: AgentMessageContent[];
}

/**
 * 流式累积器 - 用于累积流式更新
 */
export interface StreamingTurn {
	userMessage: string;
	textChunks: string[];
	thoughtChunks: string[];
	toolCalls: Map<string, ToolCall>;
	plan: Plan | null;
}
