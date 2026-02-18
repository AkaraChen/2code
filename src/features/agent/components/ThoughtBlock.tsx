import { Box, Collapsible, Flex, Icon, Text } from "@chakra-ui/react";
import { useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import * as m from "@/paraglide/messages.js";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ThoughtBlockProps {
	text: string;
}

export function ThoughtBlock({ text }: ThoughtBlockProps) {
	// 默认折叠，但如果内容很短（< 100 字符）则展开
	const [open, setOpen] = useState(text.length < 100);

	return (
		<Flex justify="flex-start" w="full">
			<Box maxW="80%" w="full">
				<Collapsible.Root
					open={open}
					onOpenChange={(e) => setOpen(e.open)}
				>
					<Collapsible.Trigger asChild>
						<Flex
							px="3"
							py="2"
							bg="purple.subtle"
							borderRadius="md"
							cursor="pointer"
							align="center"
							gap="2"
							userSelect="none"
							_hover={{ bg: "purple.muted" }}
							transition="background 0.2s"
						>
							<Icon fontSize="sm" color="purple.fg">
								{open ? <LuChevronDown /> : <LuChevronRight />}
							</Icon>
							<Text fontSize="sm" color="purple.fg" fontWeight="medium">
								{m.agentThinking()}
							</Text>
						</Flex>
					</Collapsible.Trigger>

					<Collapsible.Content>
						<Box
							px="4"
							py="3"
							mt="1"
							bg="purple.subtle"
							borderRadius="md"
							fontSize="sm"
						>
							<MarkdownRenderer
								content={text}
								bg="transparent"
								align="flex-start"
							/>
						</Box>
					</Collapsible.Content>
				</Collapsible.Root>
			</Box>
		</Flex>
	);
}
