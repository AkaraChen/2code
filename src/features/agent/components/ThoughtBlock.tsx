import { Box, Collapsible, Flex, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuChevronDown, LuChevronRight, LuBrain } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { MarkdownRenderer } from "./MarkdownRenderer";

const cardStyles = {
	w: "full",
	border: "1px solid",
	borderColor: "border.subtle",
	borderRadius: "md",
	overflow: "hidden",
} as const;

const triggerStyles = {
	px: "3",
	py: "2",
	bg: "bg.muted",
	cursor: "pointer",
	align: "center",
	gap: "2",
	userSelect: "none",
	_hover: { bg: "bg.subtle" },
	transition: "background 0.2s",
} as const;

const contentStyles = {
	px: "4",
	py: "3",
	bg: "bg.panel",
	borderTop: "1px solid",
	borderColor: "border.subtle",
	fontSize: "sm",
} as const;

interface ThoughtBlockProps {
	text: string;
}

export function ThoughtBlock({ text }: ThoughtBlockProps) {
	const [open, setOpen] = useState(text.length < 100);

	return (
		<Box {...cardStyles}>
			<Collapsible.Root
				open={open}
				onOpenChange={(e) => setOpen(e.open)}
			>
				<Collapsible.Trigger asChild>
					<Flex {...triggerStyles}>
						<Icon fontSize="sm" color="fg.muted">
							{open ? <LuChevronDown /> : <LuChevronRight />}
						</Icon>
						<Icon fontSize="sm" color="fg.muted">
							<LuBrain />
						</Icon>
						<Text fontSize="sm" color="fg.muted" fontWeight="medium">
							{m.agentThinking()}
						</Text>
					</Flex>
				</Collapsible.Trigger>

				<Collapsible.Content>
					<Box {...contentStyles}>
						<MarkdownRenderer
							content={text}
							bg="transparent"
						/>
					</Box>
				</Collapsible.Content>
			</Collapsible.Root>
		</Box>
	);
}
