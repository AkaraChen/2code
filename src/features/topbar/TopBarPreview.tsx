import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import { useDroppable } from "@dnd-kit/core";
import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import { RiGitBranchLine } from "react-icons/ri";
import * as m from "@/paraglide/messages.js";
import { DraggableControl } from "./DraggableControl";
import { controlRegistry } from "./registry";
import type { ControlId } from "./types";

interface TopBarPreviewProps {
	activeControls: ControlId[];
}

export function TopBarPreview({ activeControls }: TopBarPreviewProps) {
	const { setNodeRef } = useDroppable({ id: "preview-area" });

	return (
		<Box>
			<Text fontSize="sm" fontWeight="medium" mb="2">
				{m.topbarPreview()}
			</Text>
			<Box
				borderWidth="1px"
				borderColor="border"
				rounded="lg"
				overflow="hidden"
			>
				<Flex
					align="center"
					justify="space-between"
					px="4"
					py="3"
					bg="bg.subtle"
				>
					<HStack gap="2">
						<Text as="span" fontWeight="semibold" fontSize="sm">
							My Project
						</Text>
						<HStack gap="1" color="fg.muted" fontSize="sm">
							<RiGitBranchLine />
							<Text as="span">main</Text>
						</HStack>
					</HStack>
					<SortableContext
						items={activeControls}
						strategy={horizontalListSortingStrategy}
					>
						<HStack ref={setNodeRef} gap="2" minH="9" minW="40">
							{activeControls.length === 0 ? (
								<Text fontSize="xs" color="fg.muted">
									{m.topbarNoControls()}
								</Text>
							) : (
								activeControls.map((id) => {
									const def = controlRegistry.get(id);
									if (!def) return null;
									return (
										<DraggableControl
											key={id}
											definition={def}
										/>
									);
								})
							)}
						</HStack>
					</SortableContext>
				</Flex>
			</Box>
		</Box>
	);
}
