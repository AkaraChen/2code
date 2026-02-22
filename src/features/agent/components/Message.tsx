import { Box, Flex, Icon } from "@chakra-ui/react";
import { LuUser, LuBot } from "react-icons/lu";

interface MessageProps {
	role: "user" | "assistant";
	children: React.ReactNode;
}

export function Message({ role, children }: MessageProps) {
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
				<Icon fontSize="md">{isUser ? <LuUser /> : <LuBot />}</Icon>
			</Flex>
			<Box flex="1" minW="0" pt="1">
				{children}
			</Box>
		</Flex>
	);
}
