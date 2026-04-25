// Wrapper around MonacoFileDiff that knows which side (staged vs unstaged)
// the selected file lives on. If the file is in BOTH (which happens when
// part is staged and part isn't), we show two stacked tabs: "Unstaged" and
// "Staged" — keeping each side's hunks isolated for clean stage/unstage
// operations.

import { Box, Flex, HStack, IconButton, Tabs, Text } from "@chakra-ui/react";
import { Suspense, useMemo, useState } from "react";
import { FiX } from "react-icons/fi";

import {
	useGitFilePatch,
	useGitIndexStatus,
} from "@/features/git/hooks";

import MonacoFileDiff from "./MonacoFileDiff";

interface ChangesDiffPaneProps {
	profileId: string;
	filePath: string;
	onClose: () => void;
}

export default function ChangesDiffPane(props: ChangesDiffPaneProps) {
	return (
		<Suspense fallback={<Box p="2" fontSize="sm" color="fg.muted">Loading…</Box>}>
			<ChangesDiffPaneInner {...props} />
		</Suspense>
	);
}

function ChangesDiffPaneInner({
	profileId,
	filePath,
	onClose,
}: ChangesDiffPaneProps) {
	const { data: status } = useGitIndexStatus(profileId);

	const onStaged = useMemo(
		() => status.staged.some((e) => e.path === filePath),
		[status.staged, filePath],
	);
	const onUnstaged = useMemo(
		() => status.unstaged.some((e) => e.path === filePath),
		[status.unstaged, filePath],
	);

	// Default to whichever side the file is on; if both, prefer unstaged
	// (the more common edit target).
	const initialSide: "staged" | "unstaged" = onUnstaged
		? "unstaged"
		: "staged";
	const [side, setSide] = useState<"staged" | "unstaged">(initialSide);

	if (!onStaged && !onUnstaged) {
		// File was selected then the change disappeared (committed/discarded).
		return (
			<Flex align="center" justify="center" h="full" color="fg.muted" fontSize="sm">
				No changes for {filePath}
			</Flex>
		);
	}

	return (
		<Flex direction="column" h="full" minH="0">
			<HStack
				px="2"
				py="1"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				gap="2"
			>
				<Text fontSize="xs" color="fg.muted" flex="1" truncate>
					{filePath}
				</Text>
				{onStaged && onUnstaged && (
					<Tabs.Root
						value={side}
						onValueChange={(e) => setSide(e.value as "staged" | "unstaged")}
						size="sm"
						variant="line"
					>
						<Tabs.List borderBottomWidth="0">
							<Tabs.Trigger value="unstaged">Unstaged</Tabs.Trigger>
							<Tabs.Trigger value="staged">Staged</Tabs.Trigger>
						</Tabs.List>
					</Tabs.Root>
				)}
				<IconButton
					aria-label="Close diff"
					size="2xs"
					variant="ghost"
					onClick={onClose}
				>
					<FiX />
				</IconButton>
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
			<Box p="2" fontSize="sm" color="fg.muted">
				Loading diff…
			</Box>
		);
	}
	if (error) {
		return (
			<Box p="2" fontSize="sm" color="red.fg">
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
