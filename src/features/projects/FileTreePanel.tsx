import {
	Box,
	Flex,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
	FiChevronRight,
} from "react-icons/fi";
import {
	getIconForFile,
	getIconForFolder,
	getIconForOpenFolder,
} from "vscode-icons-js";
import type { FileEntry } from "@/generated/types";
import { useDirectoryListing } from "./hooks";
import FileViewerDialog from "./FileViewerDialog";

const ICONS_CDN = "https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@master/icons";
const FILE_TREE_PANEL_WIDTH = 208;
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
const FILE_TREE_GROUP_TRANSITION = {
	duration: 0.16,
	ease: [0.2, 0.8, 0.2, 1],
} as const;
const FILE_TREE_ICON_TRANSITION = {
	type: "spring",
	stiffness: 420,
	damping: 28,
	mass: 0.5,
} as const;

function fileIconUrl(name: string) {
	return `${ICONS_CDN}/${getIconForFile(name) ?? "default_file.svg"}`;
}

function folderIconUrl(name: string, isOpen: boolean) {
	const icon = isOpen ? getIconForOpenFolder(name) : getIconForFolder(name);
	return `${ICONS_CDN}/${icon}`;
}

interface TreeNodeProps {
	entry: FileEntry;
	depth: number;
	expandedPaths: Set<string>;
	onToggleDir: (path: string) => void;
	onOpenFile: (path: string) => void;
	prefersReducedMotion: boolean;
}

function TreeNode({
	entry,
	depth,
	expandedPaths,
	onToggleDir,
	onOpenFile,
	prefersReducedMotion,
}: TreeNodeProps) {
	const isExpanded = expandedPaths.has(entry.path);
	const { data: children, isLoading } = useDirectoryListing(
		entry.path,
		entry.is_dir && isExpanded,
	);

	const indent = depth * 12;

	if (entry.is_dir) {
		return (
			<>
				<Flex
					align="center"
					gap="1"
					px="2"
					py="0.5"
					cursor="pointer"
					borderRadius="sm"
					_hover={{ bg: "bg.subtle" }}
					onClick={() => onToggleDir(entry.path)}
					style={{ paddingLeft: `${16 + indent}px` }}
					userSelect="none"
				>
					<Box color="fg.muted" flexShrink="0" display="flex">
						<motion.span
							animate={{ rotate: isExpanded ? 90 : 0 }}
							transition={
								prefersReducedMotion
									? { duration: 0 }
									: FILE_TREE_ICON_TRANSITION
							}
							style={{ display: "inline-flex" }}
						>
							<FiChevronRight size={14} />
						</motion.span>
					</Box>
					<Box flexShrink="0" display="flex">
						<img
							src={folderIconUrl(entry.name, isExpanded)}
							width={16}
							height={16}
							alt=""
							draggable={false}
						/>
					</Box>
					<Text fontSize="sm" truncate lineClamp={1}>
						{entry.name}
					</Text>
					{isLoading && <Spinner size="xs" ml="1" />}
				</Flex>
				<AnimatePresence initial={false}>
					{isExpanded && (
						<Box asChild overflow="hidden">
							<motion.div
								initial={
									prefersReducedMotion
										? false
										: { height: 0, opacity: 0 }
								}
								animate={{ height: "auto", opacity: 1 }}
								exit={
									prefersReducedMotion
										? { height: "auto", opacity: 1 }
										: { height: 0, opacity: 0 }
								}
								transition={
									prefersReducedMotion
										? { duration: 0 }
										: FILE_TREE_GROUP_TRANSITION
								}
							>
								{children && children.map((child) => (
									<TreeNode
										key={child.path}
										entry={child}
										depth={depth + 1}
										expandedPaths={expandedPaths}
										onToggleDir={onToggleDir}
										onOpenFile={onOpenFile}
										prefersReducedMotion={prefersReducedMotion}
									/>
								))}
								{children && children.length === 0 && (
									<Text
										fontSize="sm"
										color="fg.muted"
										style={{ paddingLeft: `${16 + (depth + 1) * 12 + 18}px` }}
										py="0.5"
									>
										Empty
									</Text>
								)}
							</motion.div>
						</Box>
					)}
				</AnimatePresence>
			</>
		);
	}

	return (
		<Flex
			align="center"
			gap="1"
			px="2"
			py="0.5"
			cursor="pointer"
			borderRadius="sm"
			_hover={{ bg: "bg.subtle" }}
			onClick={() => onOpenFile(entry.path)}
			style={{ paddingLeft: `${16 + indent + 18}px` }}
			userSelect="none"
		>
			<Box flexShrink="0" display="flex">
				<img
					src={fileIconUrl(entry.name)}
					width={16}
					height={16}
					alt=""
					draggable={false}
				/>
			</Box>
			<Text fontSize="sm" truncate lineClamp={1}>
				{entry.name}
			</Text>
		</Flex>
	);
}

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
				asChild
				flexShrink="0"
				borderRightWidth={isOpen ? "1px" : "0px"}
				borderColor="border.subtle"
				bg="bg.panel"
				overflow="hidden"
				pointerEvents={isOpen ? "auto" : "none"}
				aria-hidden={!isOpen}
			>
				<motion.div
					initial={false}
					animate={{ width: isOpen ? FILE_TREE_PANEL_WIDTH : 0 }}
					transition={
						prefersReducedMotion
							? { duration: 0 }
							: FILE_TREE_PANEL_TRANSITION
					}
					style={{
						display: "flex",
						flexDirection: "column",
						minWidth: 0,
						overflow: "hidden",
						willChange: "width",
					}}
				>
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
						</motion.div>
					</Box>
				</motion.div>
			</Box>

			<FileViewerDialog
				filePath={openFilePath}
				onClose={() => setOpenFilePath(null)}
			/>
		</>
	);
}
