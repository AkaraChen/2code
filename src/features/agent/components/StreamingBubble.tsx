import { Spinner } from "@chakra-ui/react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface StreamingBubbleProps {
	content: string;
}

/**
 * 流式输出气泡
 * 显示正在生成的消息,带动画和加载指示器
 */
export function StreamingBubble({ content }: StreamingBubbleProps) {
	if (!content) return null;
	return (
		<MarkdownRenderer content={content} isAnimating>
			<Spinner size="xs" ml="2" />
		</MarkdownRenderer>
	);
}
