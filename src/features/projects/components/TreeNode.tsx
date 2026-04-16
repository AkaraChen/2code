import {
	Box,
	Flex,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { FiChevronRight } from "react-icons/fi";
import type { FileEntry } from "@/generated/types";
import * as m from "@/paraglide/messages.js";
import {
	getFileIconUrl,
	getFolderIconUrl,
} from "@/shared/lib/fileIcons";
import { useDirectoryListing } from "../hooks";

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

export interface TreeNodeProps {
	entry: FileEntry;
	depth: number;
	expandedPaths: Set<string>;
	onToggleDir: (path: string) => void;
	onOpenFile: (path: string) => void;
	prefersReducedMotion: boolean;
}

function TreeNodeLoadingRow({ depth, label }: { depth: number; label: string }) {
	return (
		<Flex
			align="center"
			gap="2"
			w="max-content"
			minW="full"
			py="0.5"
			role="status"
			aria-label={label}
			style={{ paddingLeft: `${16 + (depth + 1) * 12 + 18}px` }}
		>
			<Spinner size="xs" color="fg.muted" />
			<Text fontSize="sm" color="fg.muted">
				{m.fileTreeLoading()}
			</Text>
		</Flex>
	);
}

export function TreeNode({
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
	const childPaddingLeft = `${16 + (depth + 1) * 12 + 18}px`;
	const showLoadingRow = isExpanded && isLoading && children == null;

	if (entry.is_dir) {
		return (
			<>
				<Flex
					align="center"
					gap="1"
					w="max-content"
					minW="full"
					px="2"
					py="0.5"
					cursor="pointer"
					borderRadius="sm"
					color={isExpanded ? "fg" : "fg.muted"}
					_hover={{ bg: "bg.subtle", color: "fg" }}
					onClick={() => onToggleDir(entry.path)}
					style={{ paddingLeft: `${16 + indent}px` }}
					userSelect="none"
				>
					<motion.span
						animate={{ rotate: isExpanded ? 90 : 0 }}
						transition={
							prefersReducedMotion
								? { duration: 0 }
								: FILE_TREE_ICON_TRANSITION
						}
						style={{ display: "inline-flex", flexShrink: 0 }}
					>
						<FiChevronRight size={14} />
					</motion.span>
					<img
						src={getFolderIconUrl(entry.name, isExpanded)}
						width={16}
						height={16}
						alt=""
						draggable={false}
						style={{ flexShrink: 0 }}
					/>
					<Text fontSize="sm" whiteSpace="nowrap" flexShrink={0}>
						{entry.name}
					</Text>
					{isLoading && <Spinner size="xs" ml="1" />}
				</Flex>
				<AnimatePresence initial={false}>
					{isExpanded && (
						<Box asChild overflow="hidden">
							<motion.div
								layout={prefersReducedMotion ? false : "size"}
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
								{showLoadingRow && (
									<TreeNodeLoadingRow
										depth={depth}
										label={`Loading ${entry.name}`}
									/>
								)}
								{children?.map((child) => (
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
								{children?.length === 0 && (
									<Text
										fontSize="sm"
										color="fg.muted"
										style={{ paddingLeft: childPaddingLeft }}
										py="0.5"
										whiteSpace="nowrap"
									>
										{m.fileTreeEmptyDirectory()}
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
			w="max-content"
			minW="full"
			px="2"
			py="0.5"
			cursor="pointer"
			borderRadius="sm"
			_hover={{ bg: "bg.subtle", color: "fg" }}
			onClick={() => onOpenFile(entry.path)}
			style={{ paddingLeft: `${16 + indent + 18}px` }}
			userSelect="none"
		>
			<img
				src={getFileIconUrl(entry.name)}
				width={16}
				height={16}
				alt=""
				draggable={false}
				style={{ flexShrink: 0 }}
			/>
			<Text fontSize="sm" whiteSpace="nowrap" flexShrink={0}>
				{entry.name}
			</Text>
		</Flex>
	);
}
