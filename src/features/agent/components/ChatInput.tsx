import { Box, Button, Textarea } from "@chakra-ui/react";
import { useCallback, useState } from "react";
import { RiSendPlaneLine } from "react-icons/ri";
import * as m from "@/paraglide/messages.js";

interface ChatInputProps {
	onSend: (content: string) => void;
	disabled?: boolean;
}

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
		<Box display="flex" alignItems="end" gap="2" p="4">
			<Textarea
				value={input}
				onChange={(e) => setInput(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder={m.agentChatPlaceholder()}
				size="sm"
				resize="none"
				rows={1}
				maxH="200px"
				disabled={disabled}
				autoresize
				flex="1"
			/>
			<Button
				size="sm"
				onClick={handleSend}
				disabled={!input.trim() || disabled}
			>
				<RiSendPlaneLine />
			</Button>
		</Box>
	);
}
