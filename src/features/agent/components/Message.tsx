import { Box, Flex } from "@chakra-ui/react";
import { LuUser } from "react-icons/lu";
import { AgentIcon } from "@/shared/components/AgentIcon";

interface MessageProps {
	role: "user" | "assistant";
	agentIconUrl?: string | null;
	agentName?: string;
	children: React.ReactNode;
}

export function Message({ role, agentIconUrl, agentName, children }: MessageProps) {
	const isUser = role === "user";

	return (
		<Flex gap="4" w="full" py="4" px="4" transition="background 0.2s">
			<Flex
				shrink={0}
				w="8"
				h="8"
				align="center"
				justify="center"
				borderRadius="md"
				bg={isUser ? "colorPalette.solid" : "bg.muted"}
				color={isUser ? "colorPalette.contrast" : "fg.default"}
				border="1px solid"
				borderColor={"border.subtle"}
			>
				{isUser
					? <LuUser size={16} />
					: (
							<AgentIcon
								iconUrl={agentIconUrl}
								size={16}
								alt={agentName ?? "Agent"}
							/>
						)}
			</Flex>
			<Box flex="1" minW="0" pt="1">
				{children}
			</Box>
		</Flex>
	);
}
