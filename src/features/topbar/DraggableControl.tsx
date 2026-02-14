import { Box, HStack, Icon, Text } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RiDraggable } from "react-icons/ri";
import type { ControlDefinition } from "./types";

interface DraggableControlProps {
	definition: ControlDefinition;
	isOverlay?: boolean;
}

export function DraggableControl({
	definition,
	isOverlay,
}: DraggableControlProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: definition.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	return (
		<Box
			ref={setNodeRef}
			style={style}
			{...attributes}
			{...listeners}
			bg="bg.muted"
			rounded="md"
			px="3"
			py="2"
			cursor={isOverlay ? "grabbing" : "grab"}
			borderWidth="1px"
			borderColor={isDragging ? "border.emphasized" : "border"}
			_hover={{ borderColor: "border.emphasized" }}
			userSelect="none"
		>
			<HStack gap="2">
				<Icon color="fg.muted" fontSize="sm">
					<RiDraggable />
				</Icon>
				<Icon fontSize="md">
					<definition.icon />
				</Icon>
				<Text fontSize="sm" fontWeight="medium">
					{definition.label()}
				</Text>
			</HStack>
		</Box>
	);
}
