import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";
import { PiArrowsOutSimple } from "react-icons/pi";
import type { FileDiffMetadata } from "@pierre/diffs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";
import { FileListItem } from "./FileListItem";

const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_OFFSET = 8;

interface ChangesFileListProps {
	files: FileDiffMetadata[];
	selectedIndex: number;
	includedFileNames: Set<string>;
	onSelect: (index: number) => void;
	onToggleIncluded: (fileName: string, included: boolean) => void;
	onOpenFile: (file: FileDiffMetadata) => void;
	onDiscardFile: (file: FileDiffMetadata) => Promise<void>;
	onIncludeAll: () => void;
	onIncludeNone: () => void;
	/** Shows an expand button in the header (e.g. sidebar → diff dialog). */
	onMaximize?: () => void;
	/** Suppress file-path tooltips (e.g. compact sidebar mode). */
	tooltipsDisabled?: boolean;
}

interface ChangesFileListRowProps {
	file: FileDiffMetadata;
	index: number;
	isActive: boolean;
	isIncluded: boolean;
	tooltipsDisabled?: boolean;
	onSelect: (index: number) => void;
	onToggleIncluded: (fileName: string, included: boolean) => void;
	onOpenFile: (file: FileDiffMetadata) => void;
	onOpenContextMenu: (
		file: FileDiffMetadata,
		index: number,
		clientX: number,
		clientY: number,
	) => void;
}

const ChangesFileListRow = memo(({
	file,
	index,
	isActive,
	isIncluded,
	tooltipsDisabled,
	onSelect,
	onToggleIncluded,
	onOpenFile,
	onOpenContextMenu,
}: ChangesFileListRowProps) => {
	const handleClick = useCallback(() => {
		onSelect(index);
	}, [index, onSelect]);
	const handleDoubleClick = useCallback(() => {
		onOpenFile(file);
	}, [file, onOpenFile]);
	const handleContextMenu = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			onOpenContextMenu(file, index, event.clientX, event.clientY);
		},
		[file, index, onOpenContextMenu],
	);
	const handleToggleIncluded = useCallback(
		(included: boolean) => {
			onToggleIncluded(file.name, included);
		},
		[file.name, onToggleIncluded],
	);

	return (
		<div data-index={index}>
			<FileListItem
				file={file}
				isActive={isActive}
				isIncluded={isIncluded}
				tooltipsDisabled={tooltipsDisabled}
				onClick={handleClick}
				onDoubleClick={handleDoubleClick}
				onContextMenu={handleContextMenu}
				onToggleIncluded={handleToggleIncluded}
			/>
		</div>
	);
});

function ChangesFileList({
	files,
	selectedIndex,
	includedFileNames,
	onSelect,
	onToggleIncluded,
	onOpenFile,
	onDiscardFile,
	onIncludeAll,
	onIncludeNone,
	onMaximize,
	tooltipsDisabled,
}: ChangesFileListProps) {
	const { ref: containerRef } =
		useScrollIntoView<HTMLDivElement>(selectedIndex);
	const includedCount = includedFileNames.size;
	const [contextMenu, setContextMenu] = useState<{
		file: FileDiffMetadata;
		top: number;
		left: number;
	} | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!contextMenu) return;

		const closeContextMenu = () => setContextMenu(null);
		const handlePointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				contextMenuRef.current?.contains(event.target)
			) {
				return;
			}

			closeContextMenu();
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				closeContextMenu();
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("blur", closeContextMenu);
		window.addEventListener("resize", closeContextMenu);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("blur", closeContextMenu);
			window.removeEventListener("resize", closeContextMenu);
		};
	}, [contextMenu]);

	const openContextMenu = useCallback((
		file: FileDiffMetadata,
		index: number,
		clientX: number,
		clientY: number,
	) => {
		const maxLeft = Math.max(
			CONTEXT_MENU_OFFSET,
			window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_OFFSET,
		);
		const maxTop = Math.max(
			CONTEXT_MENU_OFFSET,
			window.innerHeight - 56 - CONTEXT_MENU_OFFSET,
		);

		onSelect(index);
		setContextMenu({
			file,
			left: Math.min(clientX, maxLeft),
			top: Math.min(clientY, maxTop),
		});
	}, [onSelect]);

	return (
		<>
			<div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
				<div className="sticky top-0 z-[1] flex items-center gap-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur">
					<Checkbox
						aria-label={m.gitCommitIncludeAll()}
						checked={files.length > 0 && includedCount === files.length}
						indeterminate={includedCount > 0 && includedCount < files.length}
						onCheckedChange={(checked) =>
							checked ? onIncludeAll() : onIncludeNone()}
					/>
					<p className="text-xs text-muted-foreground">
						{m.changedFiles({ count: files.length })}
					</p>
					{onMaximize ? (
						<Button
							size="xs"
							variant="ghost"
							aria-label={m.gitOpenDiffView()}
							className="ml-auto size-6 p-0 text-muted-foreground"
							onClick={onMaximize}
						>
							<PiArrowsOutSimple />
						</Button>
					) : null}
				</div>
				{files.map((file, i) => (
					<ChangesFileListRow
						key={file.name}
						file={file}
						index={i}
						isActive={selectedIndex === i}
						isIncluded={includedFileNames.has(file.name)}
						tooltipsDisabled={tooltipsDisabled}
						onSelect={onSelect}
						onToggleIncluded={onToggleIncluded}
						onOpenFile={onOpenFile}
						onOpenContextMenu={openContextMenu}
					/>
				))}
			</div>

			{contextMenu
				? createPortal(
					<div
						ref={contextMenuRef}
						className="fixed z-50 w-[200px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
						style={{
							top: contextMenu.top,
							left: contextMenu.left,
						}}
						onContextMenu={(event) => event.preventDefault()}
					>
						<Button
							size="sm"
							variant="destructive"
							className="w-full justify-start"
							onClick={() => {
								void onDiscardFile(contextMenu.file);
								setContextMenu(null);
							}}
						>
							{m.gitDiscardFileAction()}
						</Button>
					</div>,
					document.body,
				)
				: null}
		</>
	);
}

export default memo(ChangesFileList);
