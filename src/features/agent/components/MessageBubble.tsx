import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
	message: {
		role: "user" | "assistant";
		content: string;
	};
}

/**
 * Single message bubble.
 * Adjusts alignment and background based on message role (user/assistant).
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
