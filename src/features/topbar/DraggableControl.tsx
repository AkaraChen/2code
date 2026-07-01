import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PiDotsSixVerticalBold } from "react-icons/pi";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
		<Tooltip>
			<TooltipTrigger
				render={(
					<div
						ref={setNodeRef}
						style={style}
						{...attributes}
						{...listeners}
						className={[
							"rounded-md border bg-muted p-2 select-none hover:border-foreground/40",
							isOverlay ? "cursor-grabbing" : "cursor-grab",
							isDragging ? "border-foreground/40" : "border-border",
						].join(" ")}
					/>
				)}
			>
				<div className="flex items-center gap-1.5">
					<PiDotsSixVerticalBold className="size-4 text-muted-foreground" />
					<definition.icon size={DRAG_ICON_SIZE} />
				</div>
			</TooltipTrigger>
			<TooltipContent>{definition.label()}</TooltipContent>
		</Tooltip>
	);
}
