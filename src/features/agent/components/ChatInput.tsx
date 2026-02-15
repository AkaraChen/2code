import { Box, Button, HStack, Textarea } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { RiSendPlaneLine } from "react-icons/ri";
import * as m from "@/paraglide/messages.js";

interface ChatInputProps {
	onSend: (content: string) => void;
	disabled?: boolean;
}

/**
 * 聊天输入框
 * 支持 Enter 发送、Shift+Enter 换行
 */
export function ChatInput({ onSend, disabled = false }: ChatInputProps) {
	const [input, setInput] = useState("");

	const handleSend = useCallback(() => {
		const trimmed = input.trim();
		if (!trimmed || disabled) return;
		setInput("");
		onSend(trimmed);
	}, [input, disabled, onSend]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	return (
		<Box px="4" py="3" borderTop="1px solid" borderColor="border.subtle">
			<HStack gap="2" align="flex-end">
				<Textarea
					flex="1"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={m.agentChatPlaceholder()}
					size="sm"
					resize="none"
					rows={1}
					maxH="120px"
					disabled={disabled}
					autoresize
				/>
				<Button
					size="sm"
					onClick={handleSend}
					disabled={!input.trim() || disabled}
					colorPalette="blue"
				>
					<RiSendPlaneLine />
				</Button>
			</HStack>
		</Box>
	);
}
