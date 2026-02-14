import { Box, HStack, Icon, Portal, Tooltip } from "@chakra-ui/react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RiDraggable } from "react-icons/ri";
import type { ControlDefinition } from "./types";

const DRAG_ICON_SIZE = 16;

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
		<Tooltip.Root openDelay={300}>
			<Tooltip.Trigger asChild>
				<Box
					ref={setNodeRef}
					style={style}
					{...attributes}
					{...listeners}
					bg="bg.muted"
					rounded="md"
					p="2"
					cursor={isOverlay ? "grabbing" : "grab"}
					borderWidth="1px"
					borderColor={isDragging ? "border.emphasized" : "border"}
					_hover={{ borderColor: "border.emphasized" }}
					userSelect="none"
				>
					<HStack gap="1.5">
						<Icon color="fg.muted" fontSize="sm">
							<RiDraggable />
						</Icon>
						<definition.icon size={DRAG_ICON_SIZE} />
					</HStack>
				</Box>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{definition.label()}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}
