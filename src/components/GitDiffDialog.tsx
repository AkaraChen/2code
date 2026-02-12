import {
	Badge,
	Box,
	CloseButton,
	Dialog,
	Flex,
	HStack,
	Icon,
	Portal,
	Spinner,
	Tabs,
	Text,
} from "@chakra-ui/react";
import type {
	ChangeContent,
	FileDiffMetadata,
	FileDiffOptions,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { RiGitBranchLine } from "react-icons/ri";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import { useFontStore } from "@/stores/fontStore";
import { useThemePreference } from "./ThemeProvider";

const shikiThemeMap: Record<TerminalThemeId, string> = {
	"github-dark": "github-dark",
	"github-light": "github-light",
	dracula: "dracula",
	"ayu-dark": "ayu-dark",
	"ayu-light": "ayu-light",
	"solarized-dark": "solarized-dark",
	"solarized-light": "solarized-light",
	"one-dark": "one-dark-pro",
	"one-light": "one-light",
};

function getLineStats(file: FileDiffMetadata) {
	let additions = 0;
	let deletions = 0;
	for (const hunk of file.hunks) {
		for (const content of hunk.hunkContent) {
			if (content.type === "change") {
				const c = content as ChangeContent;
				additions += c.additions.length;
				deletions += c.deletions.length;
			}
		}
	}
	return { additions, deletions };
}

const changeTypeBadge: Record<string, { label: string; colorPalette: string }> =
	{
		new: { label: "A", colorPalette: "green" },
		deleted: { label: "D", colorPalette: "red" },
		change: { label: "M", colorPalette: "blue" },
		"rename-pure": { label: "R", colorPalette: "yellow" },
		"rename-changed": { label: "R", colorPalette: "yellow" },
	};

function FileDiffHeader({ file }: { file: FileDiffMetadata }) {
	const { additions, deletions } = useMemo(() => getLineStats(file), [file]);
	const badge = changeTypeBadge[file.type] ?? changeTypeBadge.change;
	const displayName =
		file.prevName && file.prevName !== file.name
			? `${file.prevName} → ${file.name}`
			: file.name;

	return (
		<HStack px="3" py="1.5" userSelect="none">
			<Badge size="sm" colorPalette={badge.colorPalette}>
				{badge.label}
			</Badge>
			<Text fontSize="sm" fontFamily="mono" flex="1" truncate>
				{displayName}
			</Text>
			<HStack gap="2" fontSize="xs" fontFamily="mono">
				{additions > 0 && <Text color="green.solid">+{additions}</Text>}
				{deletions > 0 && <Text color="red.solid">-{deletions}</Text>}
			</HStack>
		</HStack>
	);
}

function FileListItem({
	file,
	isActive,
	onClick,
}: {
	file: FileDiffMetadata;
	isActive: boolean;
	onClick: () => void;
}) {
	const { additions, deletions } = useMemo(() => getLineStats(file), [file]);
	const badge = changeTypeBadge[file.type] ?? changeTypeBadge.change;
	const basename = file.name.split("/").pop() ?? file.name;

	return (
		<HStack
			px="3"
			py="1"
			cursor="pointer"
			bg={isActive ? "bg.emphasized" : "transparent"}
			_hover={{ bg: isActive ? "bg.emphasized" : "bg.muted" }}
			onClick={onClick}
			gap="2"
			userSelect="none"
		>
			<Badge size="xs" colorPalette={badge.colorPalette} variant="subtle">
				{badge.label}
			</Badge>
			<Text
				fontSize="sm"
				flex="1"
				truncate
				title={file.name}
			>
				{basename}
			</Text>
			<HStack gap="1" fontSize="xs" flexShrink={0}>
				{additions > 0 && (
					<Text color="green.solid" lineHeight="1">
						+{additions}
					</Text>
				)}
				{deletions > 0 && (
					<Text color="red.solid" lineHeight="1">
						-{deletions}
					</Text>
				)}
			</HStack>
		</HStack>
	);
}

function EmptyState({ message }: { message: string }) {
	return (
		<Flex align="center" justify="center" h="full" p="8">
			<Text color="fg.muted" fontSize="sm">
				{message}
			</Text>
		</Flex>
	);
}

interface GitDiffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	contextId: string;
	branchName?: string;
}

export default function GitDiffDialog({
	isOpen,
	onClose,
	contextId,
	branchName,
}: GitDiffDialogProps) {
	const { isDark } = useThemePreference();
	const fontFamily = useFontStore((s) => s.fontFamily);
	const fontSize = useFontStore((s) => s.fontSize);
	const darkTerminalTheme = useFontStore((s) => s.darkTerminalTheme);
	const lightTerminalTheme = useFontStore((s) => s.lightTerminalTheme);
	const syncTerminalTheme = useFontStore((s) => s.syncTerminalTheme);

	const { data: diff, isLoading } = useQuery({
		queryKey: queryKeys.projects.diff(contextId),
		queryFn: () => projectsApi.getDiff(contextId),
		enabled: isOpen,
	});

	const files = useMemo(() => {
		if (!diff) return [];
		return parsePatchFiles(diff).flatMap((p) => p.files);
	}, [diff]);

	const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);

	const selectedFile =
		files.length > 0 && selectedFileIndex < files.length
			? files[selectedFileIndex]
			: null;

	const options: FileDiffOptions<unknown> = useMemo(() => {
		const termTheme = syncTerminalTheme
			? darkTerminalTheme
			: isDark
				? darkTerminalTheme
				: lightTerminalTheme;
		return {
			theme: shikiThemeMap[termTheme] ?? "github-dark",
			diffStyle: "unified",
			diffIndicators: "classic",
			disableFileHeader: true,
			overflow: "wrap",
			expandUnchanged: true,
		};
	}, [isDark, darkTerminalTheme, lightTerminalTheme, syncTerminalTheme]);

	return (
		<Dialog.Root
			lazyMount
			size="cover"
			placement="center"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content
						overflow="hidden"
						display="flex"
						flexDirection="column"
					>
						<Dialog.Header py="2" px="4">
							<Dialog.Title fontSize="sm">
								<HStack gap="1.5">
									<Icon fontSize="md">
										<RiGitBranchLine />
									</Icon>
									<Text>{branchName ?? "main"}</Text>
								</HStack>
							</Dialog.Title>
							<Dialog.CloseTrigger asChild>
								<CloseButton size="sm" />
							</Dialog.CloseTrigger>
						</Dialog.Header>

						<Dialog.Body
							p="0"
							flex="1"
							overflow="hidden"
							display="flex"
						>
							{isLoading ? (
								<Flex align="center" justify="center" flex="1">
									<Spinner />
								</Flex>
							) : (
								<>
									{/* Left Sidebar */}
									<Flex
										direction="column"
										w="320px"
										flexShrink={0}
										overflow="hidden"
									>
										<Tabs.Root
											defaultValue="changes"
											size="sm"
											variant="line"
											flex="1"
											display="flex"
											flexDirection="column"
										>
											<Tabs.List px="3">
												<Tabs.Trigger value="changes">
													Changes
												</Tabs.Trigger>
												<Tabs.Trigger value="history">
													History
												</Tabs.Trigger>
											</Tabs.List>
											<Tabs.Content
												value="changes"
												p="0"
												flex="1"
												display="flex"
												flexDirection="column"
												overflow="hidden"
											>
												{files.length === 0 ? (
													<EmptyState message="No changes detected" />
												) : (
													<>
														<Text
															px="3"
															py="1"
															fontSize="xs"
															color="fg.muted"
														>
															{files.length}{" "}
															changed{" "}
															{files.length === 1
																? "file"
																: "files"}
														</Text>
														<Box
															flex="1"
															overflowY="auto"
														>
															{files.map(
																(file, i) => (
																	<FileListItem
																		key={
																			file.name +
																			i
																		}
																		file={
																			file
																		}
																		isActive={
																			selectedFileIndex ===
																			i
																		}
																		onClick={() =>
																			setSelectedFileIndex(
																				i,
																			)
																		}
																	/>
																),
															)}
														</Box>
													</>
												)}
											</Tabs.Content>
											<Tabs.Content value="history" p="0">
												<EmptyState message="No history available" />
											</Tabs.Content>
										</Tabs.Root>
									</Flex>

									{/* Right Diff Pane */}
									<Box
										flex="1"
										overflow="auto"
										css={{
											"--diffs-font-family": `"${fontFamily}", monospace`,
											"--diffs-font-size": `${fontSize}px`,
										}}
									>
										{selectedFile ? (
											<>
												<FileDiffHeader
													file={selectedFile}
												/>
												<FileDiff
													fileDiff={selectedFile}
													options={options}
												/>
											</>
										) : (
											<EmptyState
												message={
													files.length === 0
														? "No changes detected"
														: "Select a file to view changes"
												}
											/>
										)}
									</Box>
								</>
							)}
						</Dialog.Body>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
