import {
	Box,
	Button,
	HStack,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
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
}

export default function ChangesFileList({
	files,
	selectedIndex,
	includedFileNames,
	onSelect,
	onToggleIncluded,
	onOpenFile,
	onDiscardFile,
	onIncludeAll,
	onIncludeNone,
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

	function openContextMenu(
		file: FileDiffMetadata,
		clientX: number,
		clientY: number,
	) {
		const maxLeft = Math.max(
			CONTEXT_MENU_OFFSET,
			window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_OFFSET,
		);
		const maxTop = Math.max(
			CONTEXT_MENU_OFFSET,
			window.innerHeight - 56 - CONTEXT_MENU_OFFSET,
		);

		setContextMenu({
			file,
			left: Math.min(clientX, maxLeft),
			top: Math.min(clientY, maxTop),
		});
	}

	return (
		<>
			<Box ref={containerRef} flex="1" overflowY="auto" minH="0">
				<HStack
					position="sticky"
					top="0"
					zIndex="1"
					justify="space-between"
					px="3"
					py="2.5"
					bg="bg.subtle"
					borderBottomWidth="1px"
					borderColor="border.subtle"
				>
					<Text fontSize="xs" color="fg.muted">
						{m.changedFiles({ count: files.length })}
					</Text>
					<HStack gap="1">
						<Button
							size="xs"
							variant="ghost"
							onClick={onIncludeAll}
							disabled={includedCount === files.length}
						>
							{m.gitCommitIncludeAll()}
						</Button>
						<Button
							size="xs"
							variant="ghost"
							onClick={onIncludeNone}
							disabled={includedCount === 0}
						>
							{m.gitCommitIncludeNone()}
						</Button>
					</HStack>
				</HStack>
				{files.map((file, i) => (
					<div key={file.name} data-index={i}>
						<FileListItem
							file={file}
							isActive={selectedIndex === i}
							isIncluded={includedFileNames.has(file.name)}
							onClick={() => onSelect(i)}
							onDoubleClick={() => onOpenFile(file)}
							onContextMenu={(event) => {
								event.preventDefault();
								onSelect(i);
								openContextMenu(file, event.clientX, event.clientY);
							}}
							onToggleIncluded={(included) =>
								onToggleIncluded(file.name, included)
							}
						/>
					</div>
				))}
			</Box>

			{contextMenu ? (
				<Portal>
					<Box
						ref={contextMenuRef}
						position="fixed"
						top={contextMenu.top}
						left={contextMenu.left}
						w={`${CONTEXT_MENU_WIDTH}px`}
						rounded="l2"
						borderWidth="1px"
						borderColor="border.subtle"
						bg="bg.panel"
						boxShadow="lg"
						p="1"
						zIndex="dropdown"
						onContextMenu={(event) => event.preventDefault()}
					>
						<Stack gap="1">
							<Button
								size="sm"
								variant="ghost"
								justifyContent="flex-start"
								colorPalette="red"
								onClick={() => {
									void onDiscardFile(contextMenu.file);
									setContextMenu(null);
								}}
							>
								{m.gitDiscardFileAction()}
							</Button>
						</Stack>
					</Box>
				</Portal>
			) : null}
		</>
	);
}
