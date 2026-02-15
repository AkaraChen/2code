import type { AgentMessage } from "../store";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
	message: AgentMessage;
}

/**
 * 单条消息气泡
 * 根据消息角色(用户/助手)自动调整对齐和背景色
 */
export function MessageBubble({ message }: MessageBubbleProps) {
	const isUser = message.role === "user";
	return (
		<MarkdownRenderer
			content={message.content}
			align={isUser ? "flex-end" : "flex-start"}
			bg={isUser ? "colorPalette.subtle" : "bg.muted"}
		/>
	);
}
