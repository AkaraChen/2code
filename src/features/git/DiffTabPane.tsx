// Read-only diff editor that renders inside the FileViewerTabs surface
// (alongside regular file tabs). The TerminalTabs render dispatch routes
// here when the tab path matches `2code-diff://...`.
//
// Three view modes:
//   - split:  Monaco DiffEditor side-by-side (HEAD | worktree) with full
//             language-aware syntax highlighting via detectMonacoLanguage
//   - inline: Monaco DiffEditor inline (original + modified merged) with
//             same syntax highlighting
//   - patch:  raw `git diff -- <path>` text in MonacoFileDiff; this is the
//             only mode that supports per-hunk Stage / Unstage actions
//
// Default = split. Patch view is the fallback when the file is too large
// for the diff editor.

import {
	Box,
	Flex,
	HStack,
	IconButton,
	Spinner,
	Tabs,
	Text,
	Tooltip,
	Portal,
} from "@chakra-ui/react";
import { Suspense, useState } from "react";
import { FiAlignLeft, FiColumns, FiCode } from "react-icons/fi";

import MonacoFileDiff from "./MonacoFileDiff";
import MonacoSideBySideDiff from "./MonacoSideBySideDiff";
import { parseDiffTabPath, type DiffSide } from "./diffTabs";
import {
	useGitFileDiffSides,
	useGitFilePatch,
	useGitIndexStatus,
} from "@/features/git/hooks";

type ViewMode = "split" | "inline" | "patch";

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
		initialSide === "unstaged" && !onUnstaged && onStaged
			? "staged"
			: initialSide === "staged" && !onStaged && onUnstaged
				? "unstaged"
				: initialSide,
	);
	const [view, setView] = useState<ViewMode>("split");

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
				<ViewModeToggle view={view} onChange={setView} />
			</HStack>
			<Box flex="1" minH="0">
				<DiffContent
					profileId={profileId}
					filePath={filePath}
					staged={side === "staged"}
					view={view}
				/>
			</Box>
		</Flex>
	);
}

function ViewModeToggle({
	view,
	onChange,
}: {
	view: ViewMode;
	onChange: (v: ViewMode) => void;
}) {
	return (
		<HStack gap="0">
			<ViewModeIconButton
				icon={<FiColumns />}
				label="Side-by-side"
				active={view === "split"}
				onClick={() => onChange("split")}
			/>
			<ViewModeIconButton
				icon={<FiAlignLeft />}
				label="Inline"
				active={view === "inline"}
				onClick={() => onChange("inline")}
			/>
			<ViewModeIconButton
				icon={<FiCode />}
				label="Patch (with stage/unstage hunks)"
				active={view === "patch"}
				onClick={() => onChange("patch")}
			/>
		</HStack>
	);
}

function ViewModeIconButton({
	icon,
	label,
	active,
	onClick,
}: {
	icon: React.ReactNode;
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<IconButton
					aria-label={label}
					size="2xs"
					variant={active ? "solid" : "ghost"}
					onClick={onClick}
				>
					{icon}
				</IconButton>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{label}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}

function DiffContent({
	profileId,
	filePath,
	staged,
	view,
}: {
	profileId: string;
	filePath: string;
	staged: boolean;
	view: ViewMode;
}) {
	if (view === "patch") {
		return (
			<PatchView
				profileId={profileId}
				filePath={filePath}
				staged={staged}
			/>
		);
	}
	return (
		<SidesView
			profileId={profileId}
			filePath={filePath}
			staged={staged}
			mode={view}
		/>
	);
}

function PatchView({
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

function SidesView({
	profileId,
	filePath,
	staged,
	mode,
}: {
	profileId: string;
	filePath: string;
	staged: boolean;
	mode: "split" | "inline";
}) {
	const { data, isLoading, error } = useGitFileDiffSides(
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
	if (!data) return null;

	if (data.too_large) {
		return (
			<Flex
				align="center"
				justify="center"
				h="full"
				direction="column"
				gap="2"
				color="fg.muted"
				fontSize="sm"
				p="4"
			>
				<Text>File is too large for the side-by-side view.</Text>
				<Text fontSize="xs">Switch to Patch view to inspect changes.</Text>
			</Flex>
		);
	}

	if (data.original === null && data.modified === null) {
		return (
			<Flex
				align="center"
				justify="center"
				h="full"
				color="fg.muted"
				fontSize="sm"
			>
				Binary file or unable to read
			</Flex>
		);
	}

	// Pass nulls through verbatim — MonacoSideBySideDiff renders a single-
	// pane Editor when only one side exists (added / deleted file).
	return (
		<MonacoSideBySideDiff
			filePath={filePath}
			original={data.original}
			modified={data.modified}
			mode={mode === "split" ? "side-by-side" : "inline"}
		/>
	);
}
