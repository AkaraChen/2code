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
		<Box px="4" py="4" bg="bg">
			<Box
				border="1px solid"
				borderColor="border.subtle"
				borderRadius="xl"
				bg="bg.panel"
				_focusWithin={{ borderColor: "colorPalette.solid", boxShadow: "0 0 0 1px var(--chakra-colors-color-palette-solid)" }}
				transition="all 0.2s"
				position="relative"
			>
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
					border="none"
					_focus={{ boxShadow: "none" }}
					bg="transparent"
					px="4"
					py="3"
					pr="12"
				/>
				<Button
					size="sm"
					onClick={handleSend}
					disabled={!input.trim() || disabled}
					colorPalette="blue"
					position="absolute"
					right="2"
					bottom="2"
					borderRadius="md"
					w="8"
					h="8"
					p="0"
				>
					<RiSendPlaneLine />
				</Button>
			</Box>
		</Box>
	);
}
