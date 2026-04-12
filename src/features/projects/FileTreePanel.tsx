import {
	Box,
	Flex,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { useState } from "react";
import {
	FiChevronDown,
	FiChevronRight,
	FiFile,
	FiFolder,
} from "react-icons/fi";
import type { FileEntry } from "@/generated/types";
import { useDirectoryListing } from "./hooks";
import FileViewerDialog from "./FileViewerDialog";

interface TreeNodeProps {
	entry: FileEntry;
	depth: number;
	expandedPaths: Set<string>;
	onToggleDir: (path: string) => void;
	onOpenFile: (path: string) => void;
}

function TreeNode({
	entry,
	depth,
	expandedPaths,
	onToggleDir,
	onOpenFile,
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
						{isExpanded ? (
							<FiChevronDown size={14} />
						) : (
							<FiChevronRight size={14} />
						)}
					</Box>
					<Box flexShrink="0" display="flex">
						<FiFolder size={15} />
					</Box>
					<Text fontSize="sm" truncate lineClamp={1}>
						{entry.name}
					</Text>
					{isLoading && <Spinner size="xs" ml="1" />}
				</Flex>
				{isExpanded && children && children.map((child) => (
					<TreeNode
						key={child.path}
						entry={child}
						depth={depth + 1}
						expandedPaths={expandedPaths}
						onToggleDir={onToggleDir}
						onOpenFile={onOpenFile}
					/>
				))}
				{isExpanded && children && children.length === 0 && (
					<Text
						fontSize="sm"
						color="fg.muted"
						style={{ paddingLeft: `${16 + (depth + 1) * 12 + 14}px` }}
						py="0.5"
					>
						Empty
					</Text>
				)}
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
			style={{ paddingLeft: `${16 + indent + 14}px` }}
			userSelect="none"
		>
			<Box color="fg.muted" flexShrink="0" display="flex">
				<FiFile size={15} />
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
}

export default function FileTreePanel({ rootPath, isOpen }: FileTreePanelProps) {
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [openFilePath, setOpenFilePath] = useState<string | null>(null);

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

	return (
		<>
			{isOpen && (
				<Flex
					direction="column"
					w="52"
					flexShrink="0"
					borderRightWidth="1px"
					borderColor="border.subtle"
					overflow="hidden"
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
								onOpenFile={setOpenFilePath}
							/>
						))}
					</Box>
				</Flex>
			)}

			<FileViewerDialog
				filePath={openFilePath}
				onClose={() => setOpenFilePath(null)}
			/>
		</>
	);
}
