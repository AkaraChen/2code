import { Box, Flex, Spinner } from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import * as m from "@/paraglide/messages.js";
import { useHorizontalResize } from "@/shared/hooks/useHorizontalResize";
import { useDirectoryListing } from "./hooks";
import FileViewerDialog from "./FileViewerDialog";
import {
	FILE_TREE_PANEL_MAX_WIDTH,
	FILE_TREE_PANEL_MIN_WIDTH,
	useFileTreeStore,
} from "./fileTreeStore";
import { TreeNode } from "./components/TreeNode";

const FILE_TREE_PANEL_TRANSITION = {
	type: "spring",
	stiffness: 320,
	damping: 34,
	mass: 0.9,
} as const;
const FILE_TREE_CONTENT_TRANSITION = {
	duration: 0.18,
	ease: [0.22, 1, 0.36, 1],
} as const;

interface FileTreePanelProps {
	rootPath: string;
	isOpen: boolean;
	onOpenFile?: (filePath: string) => void;
}

export default function FileTreePanel({ rootPath, isOpen, onOpenFile }: FileTreePanelProps) {
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
		() => new Set(),
	);
	const [openFilePath, setOpenFilePath] = useState<string | null>(null);
	const prefersReducedMotion = useReducedMotion() ?? false;
	const panelWidth = useFileTreeStore((s) => s.panelWidth);
	const setPanelWidth = useFileTreeStore((s) => s.setPanelWidth);
	const resize = useHorizontalResize({
		value: panelWidth,
		min: FILE_TREE_PANEL_MIN_WIDTH,
		max: FILE_TREE_PANEL_MAX_WIDTH,
		disabled: !isOpen,
		onChange: setPanelWidth,
	});

	const { data: rootEntries, isLoading } = useDirectoryListing(rootPath, isOpen);

	function toggleDir(path: string) {
		setExpandedPaths((prev) => {
			const next = new Set(prev);
			if (next.has(path)) {
				next.delete(path);
			} else {
				next.add(path);
			}
			return next;
		});
	}

	function handleOpenFile(filePath: string) {
		if (onOpenFile) {
			onOpenFile(filePath);
		} else {
			setOpenFilePath(filePath);
		}
	}

	return (
		<>
			<Box
				h="full"
				flexShrink="0"
				pointerEvents={isOpen ? "auto" : "none"}
				aria-hidden={!isOpen}
			>
				<Box asChild h="full">
					<motion.div
						initial={false}
						animate={{ width: isOpen ? panelWidth : 0 }}
						transition={
							prefersReducedMotion || resize.isDragging
								? { duration: 0 }
								: FILE_TREE_PANEL_TRANSITION
						}
						style={{
							display: "flex",
							flexDirection: "column",
							minWidth: 0,
							overflow: "visible",
							position: "relative",
							willChange: "width",
						}}
					>
						<Box display="flex" flex="1" minH="0" overflow="hidden">
							<Box asChild flex="1" minH="0">
								<motion.div
									initial={false}
									animate={{
										opacity: isOpen ? 1 : 0,
										x: isOpen ? 0 : -12,
									}}
									transition={
										prefersReducedMotion
											? { duration: 0 }
											: FILE_TREE_CONTENT_TRANSITION
									}
									style={{
										display: "flex",
										flex: 1,
										minHeight: 0,
										minWidth: 0,
									}}
								>
									<Box overflow="auto" flex="1" py="1">
										<Box minW="max-content" minH="full" color="fg.muted">
											{isLoading && (
												<Flex align="center" justify="center" py="4">
													<Spinner size="xs" />
												</Flex>
											)}
											{rootEntries?.map((entry) => (
												<TreeNode
													key={entry.path}
													entry={entry}
													depth={0}
													expandedPaths={expandedPaths}
													onToggleDir={toggleDir}
													onOpenFile={handleOpenFile}
													prefersReducedMotion={prefersReducedMotion}
												/>
											))}
										</Box>
									</Box>
								</motion.div>
							</Box>
						</Box>
						{isOpen && (
							<Box
								role="separator"
								aria-label={m.fileTreeResizeSeparator()}
								aria-orientation="vertical"
								aria-valuemin={FILE_TREE_PANEL_MIN_WIDTH}
								aria-valuemax={FILE_TREE_PANEL_MAX_WIDTH}
								aria-valuenow={panelWidth}
								tabIndex={0}
								position="absolute"
								top="0"
								right="-4px"
								bottom="0"
								w="8px"
								cursor="col-resize"
								zIndex={1}
								onPointerDown={resize.handlePointerDown}
								onKeyDown={resize.handleKeyDown}
								_focusVisible={{ outline: "none" }}
							/>
						)}
					</motion.div>
				</Box>
			</Box>

			<FileViewerDialog
				filePath={openFilePath}
				onClose={() => setOpenFilePath(null)}
			/>
		</>
	);
}
