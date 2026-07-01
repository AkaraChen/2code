import {
	SortableContext,
	horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { PiGitBranchFill } from "react-icons/pi";
import * as m from "@/paraglide/messages.js";
import { controlRegistry } from "./registry";
import { DraggableControl } from "./DraggableControl";
import type { ControlId } from "./types";

interface TopBarPreviewProps {
	activeControls: ControlId[];
}

export function TopBarPreview({ activeControls }: TopBarPreviewProps) {
	const { setNodeRef } = useDroppable({ id: "preview-area" });

	return (
		<div>
			<div className="mb-2 text-sm font-medium">
				{m.topbarPreview()}
			</div>
			<div className="overflow-hidden rounded-lg border">
				<div className="flex items-center justify-between bg-muted px-4 py-3">
					<div className="flex items-center gap-2">
						<span className="select-none text-sm font-semibold">
							My Project
						</span>
						<span className="flex select-none items-center gap-1 text-sm text-muted-foreground">
							<PiGitBranchFill />
							<span>main</span>
						</span>
					</div>
					<SortableContext
						items={activeControls}
						strategy={horizontalListSortingStrategy}
					>
						<div ref={setNodeRef} className="flex min-h-9 min-w-40 items-center gap-2">
							{activeControls.length === 0 ? (
								<span className="text-xs text-muted-foreground">
									{m.topbarNoControls()}
								</span>
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
						</div>
					</SortableContext>
				</div>
			</div>
		</div>
	);
}
