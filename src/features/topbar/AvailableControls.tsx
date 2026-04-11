import { Box, HStack, Text } from "@chakra-ui/react";
import { useDroppable } from "@dnd-kit/core";
import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import * as m from "@/paraglide/messages.js";
import { DraggableControl } from "./DraggableControl";
import { controlRegistry } from "./registry";
import type { ControlId } from "./types";

interface AvailableControlsProps {
	activeControls: ControlId[];
	supportedControls: ControlId[];
}

export function AvailableControls({
	activeControls,
	supportedControls,
}: AvailableControlsProps) {
	const available = supportedControls.filter(
		(id) => !activeControls.includes(id),
	);
	const { setNodeRef } = useDroppable({ id: "available-area" });

	return (
		<Box>
			<Text fontSize="sm" fontWeight="medium" mb="2">
				{m.topbarAvailable()}
			</Text>
			<SortableContext
				items={available}
				strategy={horizontalListSortingStrategy}
			>
				<HStack
					ref={setNodeRef}
					gap="2"
					minH="12"
					p="3"
					borderWidth="1px"
					borderColor="border"
					borderStyle="dashed"
					rounded="lg"
				>
					{available.length === 0 ? (
						<Text fontSize="xs" color="fg.muted">
							{m.topbarAllControlsActive()}
						</Text>
					) : (
						available.map((id) => {
							const def = controlRegistry.get(id);
							if (!def) return null;
							return (
								<DraggableControl key={id} definition={def} />
							);
						})
					)}
				</HStack>
			</SortableContext>
		</Box>
	);
}
