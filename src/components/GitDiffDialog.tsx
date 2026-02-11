import {
	Badge,
	Box,
	Button,
	Checkbox,
	Dialog,
	Flex,
	HStack,
	Icon,
	IconButton,
	Input,
	Portal,
	Spinner,
	Tabs,
	Text,
	Textarea,
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
import {
	RiFileLine,
	RiGitBranchLine,
	RiLayoutColumnLine,
	RiMore2Line,
	RiRefreshLine,
} from "react-icons/ri";
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
		<HStack
			px="3"
			py="2"
			bg="bg.muted"
			borderBottomWidth="1px"
			borderColor="border"
			userSelect="none"
		>
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
			py="1.5"
			cursor="pointer"
			bg={isActive ? "bg.emphasized" : "transparent"}
			_hover={{ bg: isActive ? "bg.emphasized" : "bg.subtle" }}
			onClick={onClick}
			gap="2"
			userSelect="none"
		>
			<Checkbox.Root size="sm" variant="outline" checked={false} readOnly>
				<Checkbox.HiddenInput />
				<Checkbox.Control />
			</Checkbox.Root>
			<Icon fontSize="sm" color="fg.muted">
				<RiFileLine />
			</Icon>
			<Text
				fontSize="sm"
				flex="1"
				truncate
				title={file.name}
				fontFamily="mono"
			>
				{basename}
			</Text>
			<Badge size="xs" colorPalette={badge.colorPalette} variant="subtle">
				{badge.label}
			</Badge>
			<HStack gap="1" fontSize="xs" fontFamily="mono" flexShrink={0}>
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
						{/* Top Bar */}
						<HStack
							px="3"
							py="2"
							borderBottomWidth="1px"
							borderColor="border"
							bg="bg.muted"
							gap="2"
							flexShrink={0}
						>
							<Dialog.CloseTrigger asChild>
								<IconButton
									aria-label="Close"
									size="xs"
									variant="ghost"
								>
									✕
								</IconButton>
							</Dialog.CloseTrigger>
							<HStack gap="1" color="fg.muted" fontSize="sm">
								<Icon fontSize="md">
									<RiGitBranchLine />
								</Icon>
								<Text fontWeight="medium">
									{branchName ?? "main"}
								</Text>
							</HStack>
							<Box flex="1" />
							<IconButton
								aria-label="Fetch"
								size="xs"
								variant="ghost"
								disabled
							>
								<RiRefreshLine />
							</IconButton>
							<IconButton
								aria-label="Toggle view"
								size="xs"
								variant="ghost"
								disabled
							>
								<RiLayoutColumnLine />
							</IconButton>
							<IconButton
								aria-label="More options"
								size="xs"
								variant="ghost"
								disabled
							>
								<RiMore2Line />
							</IconButton>
						</HStack>

						{/* Body */}
						{isLoading ? (
							<Flex align="center" justify="center" flex="1">
								<Spinner />
							</Flex>
						) : (
							<Flex flex="1" overflow="hidden">
								{/* Left Sidebar */}
								<Flex
									direction="column"
									w="320px"
									flexShrink={0}
									borderRightWidth="1px"
									borderColor="border"
									overflow="hidden"
								>
									{/* Tabs */}
									<Tabs.Root
										defaultValue="changes"
										size="sm"
										variant="line"
									>
										<Tabs.List px="2">
											<Tabs.Trigger value="changes">
												Changes
											</Tabs.Trigger>
											<Tabs.Trigger value="history">
												History
											</Tabs.Trigger>
										</Tabs.List>
										<Tabs.Content value="changes" p="0">
											{files.length === 0 ? (
												<EmptyState message="No changes detected" />
											) : (
												<>
													{/* Search */}
													<Box px="2" py="2">
														<Input
															size="sm"
															placeholder="Filter changed files"
															disabled
														/>
													</Box>

													{/* Select all */}
													<HStack
														px="3"
														py="1"
														fontSize="xs"
														color="fg.muted"
													>
														<Checkbox.Root
															size="sm"
															variant="outline"
															checked={false}
															readOnly
														>
															<Checkbox.HiddenInput />
															<Checkbox.Control />
														</Checkbox.Root>
														<Text>
															{files.length}{" "}
															changed{" "}
															{files.length === 1
																? "file"
																: "files"}
														</Text>
													</HStack>

													{/* File List */}
													<Box
														flex="1"
														overflowY="auto"
														borderTopWidth="1px"
														borderColor="border"
													>
														{files.map(
															(file, i) => (
																<FileListItem
																	key={
																		file.name +
																		i
																	}
																	file={file}
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

									{/* Commit Form (pinned to bottom) */}
									<Flex
										direction="column"
										gap="2"
										p="2"
										borderTopWidth="1px"
										borderColor="border"
										mt="auto"
										flexShrink={0}
									>
										<Input
											size="sm"
											placeholder="Summary (required)"
											disabled
										/>
										<Textarea
											size="sm"
											placeholder="Description"
											rows={3}
											resize="none"
											disabled
										/>
										<Button
											size="sm"
											colorPalette="blue"
											w="full"
											disabled
										>
											Commit to {branchName ?? "main"}
										</Button>
									</Flex>
								</Flex>

								{/* Right Diff Pane */}
								<Box flex="1" overflow="auto">
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
							</Flex>
						)}
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
