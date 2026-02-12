import {
	Badge,
	Box,
	CloseButton,
	Dialog,
	Flex,
	HStack,
	Icon,
	IconButton,
	Portal,
	Spinner,
	Tabs,
	Text,
	VStack,
} from "@chakra-ui/react";
import type {
	ChangeContent,
	FileDiffMetadata,
	FileDiffOptions,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import {
	RiArrowLeftLine,
	RiGitBranchLine,
	RiGitCommitLine,
} from "react-icons/ri";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import type { GitCommit } from "@/types";
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

function formatRelativeTime(isoDate: string): string {
	const now = Date.now();
	const then = new Date(isoDate).getTime();
	const diffSec = Math.floor((now - then) / 1000);

	if (diffSec < 60) return "just now";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return `${diffDay}d ago`;
	const diffMonth = Math.floor(diffDay / 30);
	if (diffMonth < 12) return `${diffMonth}mo ago`;
	const diffYear = Math.floor(diffMonth / 12);
	return `${diffYear}y ago`;
}

function CommitListItem({
	commit,
	onClick,
}: {
	commit: GitCommit;
	onClick: () => void;
}) {
	return (
		<VStack
			align="stretch"
			px="3"
			py="1.5"
			cursor="pointer"
			_hover={{ bg: "bg.muted" }}
			onClick={onClick}
			gap="0.5"
			userSelect="none"
		>
			<Text fontSize="sm" lineClamp={1}>
				{commit.message}
			</Text>
			<HStack gap="2" fontSize="xs" color="fg.muted">
				<HStack gap="1">
					<Icon fontSize="xs">
						<RiGitCommitLine />
					</Icon>
					<Text fontFamily="mono">{commit.hash}</Text>
				</HStack>
				<Text truncate flex="1">
					{commit.author.name}
				</Text>
				<Text flexShrink={0}>
					{formatRelativeTime(commit.date)}
				</Text>
			</HStack>
			<HStack gap="2" fontSize="xs">
				{commit.files_changed > 0 && (
					<Text color="fg.muted">
						{commit.files_changed} {commit.files_changed === 1 ? "file" : "files"}
					</Text>
				)}
				{commit.insertions > 0 && (
					<Text color="green.solid">+{commit.insertions}</Text>
				)}
				{commit.deletions > 0 && (
					<Text color="red.solid">-{commit.deletions}</Text>
				)}
			</HStack>
		</VStack>
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

	const [activeTab, setActiveTab] = useState<string>("changes");
	const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
	const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
	const [selectedCommitFileIndex, setSelectedCommitFileIndex] = useState<number>(0);

	const { data: diff, isLoading: isDiffLoading } = useQuery({
		queryKey: queryKeys.projects.diff(contextId),
		queryFn: () => projectsApi.getDiff(contextId),
		enabled: isOpen && activeTab === "changes",
	});

	const { data: logData, isLoading: isLogLoading } = useQuery({
		queryKey: queryKeys.projects.log(contextId),
		queryFn: () => projectsApi.getLog(contextId),
		enabled: isOpen && activeTab === "history",
	});

	const { data: commitDiff, isLoading: isCommitDiffLoading } = useQuery({
		queryKey: queryKeys.projects.commitDiff(
			contextId,
			selectedCommit?.full_hash ?? "",
		),
		queryFn: () =>
			projectsApi.getCommitDiff(contextId, selectedCommit!.full_hash),
		enabled: isOpen && !!selectedCommit,
	});

	const files = useMemo(() => {
		if (!diff) return [];
		return parsePatchFiles(diff).flatMap((p) => p.files);
	}, [diff]);

	const commitFiles = useMemo(() => {
		if (!commitDiff) return [];
		return parsePatchFiles(commitDiff).flatMap((p) => p.files);
	}, [commitDiff]);

	const selectedFile =
		files.length > 0 && selectedFileIndex < files.length
			? files[selectedFileIndex]
			: null;

	const selectedCommitFile =
		commitFiles.length > 0 && selectedCommitFileIndex < commitFiles.length
			? commitFiles[selectedCommitFileIndex]
			: null;

	// The file shown in the right pane depends on which tab is active
	const activeFile =
		activeTab === "history" ? selectedCommitFile : selectedFile;

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

	const handleClose = useCallback(() => {
		setActiveTab("changes");
		setSelectedFileIndex(0);
		setSelectedCommit(null);
		setSelectedCommitFileIndex(0);
		onClose();
	}, [onClose]);

	const handleTabChange = useCallback((value: string) => {
		setActiveTab(value);
		setSelectedCommit(null);
		setSelectedCommitFileIndex(0);
	}, []);

	const handleCommitBack = useCallback(() => {
		setSelectedCommit(null);
		setSelectedCommitFileIndex(0);
	}, []);

	const isLoading =
		(activeTab === "changes" && isDiffLoading) ||
		(activeTab === "history" && isLogLoading);

	return (
		<Dialog.Root
			lazyMount
			size="cover"
			placement="center"
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) handleClose();
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
											value={activeTab}
											onValueChange={(e) =>
												handleTabChange(e.value)
											}
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
											<Tabs.Content
												value="history"
												p="0"
												flex="1"
												display="flex"
												flexDirection="column"
												overflow="hidden"
											>
												{selectedCommit ? (
													<>
														<HStack
															px="2"
															py="1"
															gap="1"
														>
															<IconButton
																size="xs"
																variant="ghost"
																aria-label="Back to commit list"
																onClick={
																	handleCommitBack
																}
															>
																<RiArrowLeftLine />
															</IconButton>
															<VStack
																align="start"
																gap="0"
																flex="1"
																minW="0"
															>
																<Text
																	fontSize="sm"
																	fontWeight="medium"
																	lineClamp={
																		1
																	}
																>
																	{
																		selectedCommit.message
																	}
																</Text>
																<Text
																	fontSize="xs"
																	color="fg.muted"
																	fontFamily="mono"
																>
																	{
																		selectedCommit.hash
																	}
																</Text>
															</VStack>
														</HStack>
														{isCommitDiffLoading ? (
															<Flex
																align="center"
																justify="center"
																flex="1"
															>
																<Spinner
																	size="sm"
																/>
															</Flex>
														) : commitFiles.length ===
															0 ? (
															<EmptyState message="No file changes" />
														) : (
															<>
																<Text
																	px="3"
																	py="1"
																	fontSize="xs"
																	color="fg.muted"
																>
																	{
																		commitFiles.length
																	}{" "}
																	changed{" "}
																	{commitFiles.length ===
																	1
																		? "file"
																		: "files"}
																</Text>
																<Box
																	flex="1"
																	overflowY="auto"
																>
																	{commitFiles.map(
																		(
																			file,
																			i,
																		) => (
																			<FileListItem
																				key={
																					file.name +
																					i
																				}
																				file={
																					file
																				}
																				isActive={
																					selectedCommitFileIndex ===
																					i
																				}
																				onClick={() =>
																					setSelectedCommitFileIndex(
																						i,
																					)
																				}
																			/>
																		),
																	)}
																</Box>
															</>
														)}
													</>
												) : (logData?.length ?? 0) ===
													0 ? (
													<EmptyState message="No commits found" />
												) : (
													<Box
														flex="1"
														overflowY="auto"
													>
														{logData?.map(
															(commit) => (
																<CommitListItem
																	key={
																		commit.full_hash
																	}
																	commit={
																		commit
																	}
																	onClick={() => {
																		setSelectedCommit(
																			commit,
																		);
																		setSelectedCommitFileIndex(
																			0,
																		);
																	}}
																/>
															),
														)}
													</Box>
												)}
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
										{activeTab === "history" &&
										selectedCommit &&
										isCommitDiffLoading ? (
											<Flex
												align="center"
												justify="center"
												flex="1"
												h="full"
											>
												<Spinner />
											</Flex>
										) : activeFile ? (
											<>
												<FileDiffHeader
													file={activeFile}
												/>
												<FileDiff
													fileDiff={activeFile}
													options={options}
												/>
											</>
										) : (
											<EmptyState
												message={
													activeTab === "changes"
														? files.length === 0
															? "No changes detected"
															: "Select a file to view changes"
														: selectedCommit
															? "Select a file to view changes"
															: "Select a commit to view its diff"
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
