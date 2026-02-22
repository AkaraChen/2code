import { Box, Flex, Icon } from "@chakra-ui/react";
import { LuUser, LuBot } from "react-icons/lu";

const avatarBase = {
	shrink: 0,
	w: "8",
	h: "8",
	align: "center",
	justify: "center",
	borderRadius: "md",
	border: "1px solid",
	borderColor: "border.subtle",
} as const;

const avatarVariants = {
	user: { bg: "colorPalette.solid", color: "colorPalette.contrast" },
	assistant: { bg: "bg.muted", color: "fg.default" },
} as const;

interface MessageProps {
	role: "user" | "assistant";
	children: React.ReactNode;
}

export function Message({ role, children }: MessageProps) {
	return (
		<Flex gap="4" w="full" py="4" px="4" transition="background 0.2s">
			<Flex {...avatarBase} {...avatarVariants[role]}>
				<Icon fontSize="md">
					{role === "user" ? <LuUser /> : <LuBot />}
				</Icon>
			</Flex>
			<Box flex="1" minW="0" pt="1">
				{children}
			</Box>
		</Flex>
	);
}
