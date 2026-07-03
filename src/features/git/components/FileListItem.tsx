import type { FileDiffMetadata } from "@pierre/diffs";
import type { MouseEventHandler } from "react";
import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import OverflowTooltipText from "@/shared/components/OverflowTooltipText";
import { cn } from "@/lib/utils";
import { changeBadge, getFileDisplayParts } from "../utils";

interface FileListItemProps {
	file: FileDiffMetadata;
	isActive: boolean;
	isIncluded?: boolean;
	tooltipsDisabled?: boolean;
	onClick: () => void;
	onDoubleClick?: () => void;
	onContextMenu?: MouseEventHandler<HTMLDivElement>;
	onToggleIncluded?: (included: boolean) => void;
}

function FileListItemComponent({
	file,
	isActive,
	isIncluded,
	tooltipsDisabled = false,
	onClick,
	onDoubleClick,
	onContextMenu,
	onToggleIncluded,
}: FileListItemProps) {
	const badge = changeBadge[file.type] ?? changeBadge.change;
	const { basename, parentPath } = useMemo(
		() => getFileDisplayParts(file.name),
		[file.name],
	);
	const effectiveIncluded = isIncluded ?? true;

	return (
		<div
			data-testid="git-file-list-item"
			className={cn(
				"flex w-full min-w-0 select-none items-start gap-2 overflow-hidden px-3 py-2",
				isActive ? "bg-muted" : "hover:bg-muted/70",
				!effectiveIncluded && "opacity-70",
			)}
			onClick={onClick}
			onDoubleClick={onDoubleClick}
			onContextMenu={onContextMenu}
		>
			{onToggleIncluded ? (
				<Checkbox
					className="mt-0.5"
					checked={effectiveIncluded}
					onClick={(event) => event.stopPropagation()}
					onCheckedChange={onToggleIncluded}
				/>
			) : null}

			<div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
				<OverflowTooltipText
					displayValue={basename}
					tooltipValue={file.name}
					tooltipDisabled={tooltipsDisabled}
					className={cn(
						"min-w-0 flex-[1_1_auto] text-sm",
						isActive && "font-medium",
					)}
				/>
				{parentPath && (
					<OverflowTooltipText
						displayValue={parentPath}
						tooltipValue={file.name}
						tooltipDisabled={tooltipsDisabled}
						className="min-w-[2ch] flex-[0_10_auto] text-xs text-muted-foreground"
					/>
				)}
				<Badge
					variant="outline"
					className={cn("ml-auto h-4 shrink-0 px-1.5 font-mono text-[10px]", badge.className)}
				>
					{badge.label}
				</Badge>
			</div>
		</div>
	);
}

export const FileListItem = memo(FileListItemComponent);
