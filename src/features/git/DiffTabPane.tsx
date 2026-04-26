// Read-only diff editor that renders inside the FileViewerTabs surface
// (alongside regular file tabs). The TerminalTabs render dispatch routes
// here when the tab path matches `2code-diff://...`.
//
// Side-by-side by default since we now have the full editor width — much
// more room than the cramped in-panel pane.

import { Box, Flex, HStack, Spinner, Tabs, Text } from "@chakra-ui/react";
import { Suspense, useState } from "react";

import MonacoFileDiff from "./MonacoFileDiff";
import { parseDiffTabPath, type DiffSide } from "./diffTabs";
import {
	useGitFilePatch,
	useGitIndexStatus,
} from "@/features/git/hooks";

interface DiffTabPaneProps {
	profileId: string;
	tabPath: string;
}

export default function DiffTabPane({ profileId, tabPath }: DiffTabPaneProps) {
	const parsed = parseDiffTabPath(tabPath);
	if (!parsed) {
		return (
			<Box p="4" color="fg.muted" fontSize="sm">
				Invalid diff tab: {tabPath}
			</Box>
		);
	}
	return (
		<Suspense
			fallback={
				<Flex align="center" justify="center" h="full">
					<Spinner size="sm" />
				</Flex>
			}
		>
			<DiffTabPaneInner
				profileId={profileId}
				filePath={parsed.filePath}
				initialSide={parsed.side}
			/>
		</Suspense>
	);
}

function DiffTabPaneInner({
	profileId,
	filePath,
	initialSide,
}: {
	profileId: string;
	filePath: string;
	initialSide: DiffSide;
}) {
	const { data: status } = useGitIndexStatus(profileId);

	const onStaged = status.staged.some((e) => e.path === filePath);
	const onUnstaged = status.unstaged.some((e) => e.path === filePath);

	const [side, setSide] = useState<DiffSide>(
		// Snap to a side that actually has changes for this file.
		initialSide === "unstaged" && !onUnstaged && onStaged
			? "staged"
			: initialSide === "staged" && !onStaged && onUnstaged
				? "unstaged"
				: initialSide,
	);

	if (!onStaged && !onUnstaged) {
		return (
			<Flex
				align="center"
				justify="center"
				h="full"
				color="fg.muted"
				fontSize="sm"
				direction="column"
				gap="2"
			>
				<Text>No changes for {filePath}</Text>
				<Text fontSize="xs">
					The file may have been committed or discarded. Close this tab.
				</Text>
			</Flex>
		);
	}

	return (
		<Flex direction="column" h="full" minH="0">
			<HStack
				px="3"
				py="1.5"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				gap="2"
				flexShrink={0}
			>
				<Text fontSize="sm" fontFamily="mono" flex="1" truncate>
					{filePath}
				</Text>
				{onStaged && onUnstaged && (
					<Tabs.Root
						value={side}
						onValueChange={(e) => setSide(e.value as DiffSide)}
						size="sm"
						variant="line"
					>
						<Tabs.List borderBottomWidth="0">
							<Tabs.Trigger value="unstaged">Unstaged</Tabs.Trigger>
							<Tabs.Trigger value="staged">Staged</Tabs.Trigger>
						</Tabs.List>
					</Tabs.Root>
				)}
				{!onStaged || !onUnstaged ? (
					<Text fontSize="xs" color="fg.muted">
						{side === "staged" ? "Staged" : "Unstaged"}
					</Text>
				) : null}
			</HStack>
			<Box flex="1" minH="0">
				<DiffContent
					profileId={profileId}
					filePath={filePath}
					staged={side === "staged"}
				/>
			</Box>
		</Flex>
	);
}

function DiffContent({
	profileId,
	filePath,
	staged,
}: {
	profileId: string;
	filePath: string;
	staged: boolean;
}) {
	const { data: rawPatch, isLoading, error } = useGitFilePatch(
		profileId,
		filePath,
		staged,
	);

	if (isLoading) {
		return (
			<Flex align="center" justify="center" h="full">
				<Spinner size="sm" />
			</Flex>
		);
	}
	if (error) {
		return (
			<Box p="3" fontSize="sm" color="red.fg">
				{String(error)}
			</Box>
		);
	}
	return (
		<MonacoFileDiff
			profileId={profileId}
			filePath={filePath}
			staged={staged}
			rawPatch={rawPatch ?? ""}
		/>
	);
}
