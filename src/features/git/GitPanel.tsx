// Phase 2 Git Panel.
//
// Lives inside TerminalLayer's per-profile flex so it follows the same
// "never-unmount, CSS display" persistence pattern as terminals. Width is
// shared across profiles (one resize → all profiles match), open state +
// active tab + commit draft are per-profile (so switching projects doesn't
// smear UI state).
//
// Phase 2 ships the Changes tab; History/Branches/Stash tabs render
// placeholders until Phases 3 and 4 land.

import {
	Box,
	Flex,
	HStack,
	IconButton,
	Tabs,
	Tooltip,
	Portal,
} from "@chakra-ui/react";
import { Suspense, useCallback } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { FiX } from "react-icons/fi";

import BranchesTab from "./BranchesTab";
import ChangesTab from "./ChangesTab";
import CommitComposer from "./CommitComposer";
import GraphLogTab from "./GraphLogTab";
import InProgressBanner from "./InProgressBanner";
import InitRepoFlow from "./InitRepoFlow";
import StashTab from "./StashTab";
import { buildDiffTabPath, diffTabTitle, type DiffSide } from "./diffTabs";
import { useIsGitRepo, useGitIndexStatus } from "@/features/git/hooks";
import { useGitPanelStore, type GitPanelTab } from "./gitPanelStore";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";

interface GitPanelProps {
	profileId: string;
}

export default function GitPanel({ profileId }: GitPanelProps) {
	const open = useGitPanelStore((s) => s.getOpen(profileId));
	const tab = useGitPanelStore((s) => s.getTab(profileId));
	const width = useGitPanelStore((s) => s.width);
	const setTab = useGitPanelStore((s) => s.setTab);
	const setOpen = useGitPanelStore((s) => s.setOpen);
	const setWidth = useGitPanelStore((s) => s.setWidth);
	const isRepo = useIsGitRepo(profileId);

	// Drag-to-resize handle. Mouse down starts a drag; mouse move resizes;
	// mouse up commits. Uses requestAnimationFrame to coalesce rapid moves.
	// All handlers live inside startDrag so we don't need named refs to each
	// other (which the React Compiler can't optimize through).
	const startDrag = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = width;
			let raf: number | undefined;

			const onMouseMove = (ev: MouseEvent) => {
				if (raf !== undefined) return;
				raf = requestAnimationFrame(() => {
					const dx = startX - ev.clientX; // dragging left grows panel
					setWidth(startWidth + dx);
					raf = undefined;
				});
			};

			const onMouseUp = () => {
				if (raf !== undefined) cancelAnimationFrame(raf);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("mousemove", onMouseMove);
				window.removeEventListener("mouseup", onMouseUp);
			};

			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("mousemove", onMouseMove);
			window.addEventListener("mouseup", onMouseUp);
		},
		[width, setWidth],
	);

	if (!open) return null;

	return (
		<Flex
			direction="row"
			h="full"
			minW="0"
			borderInlineStartWidth="1px"
			borderColor="border.subtle"
		>
			{/* Resize handle */}
			<Box
				width="4px"
				cursor="col-resize"
				bg="transparent"
				_hover={{ bg: "border.emphasized" }}
				onMouseDown={startDrag}
				flexShrink={0}
			/>

			<Flex
				direction="column"
				flex="1"
				minW="0"
				width={`${width}px`}
				maxWidth={`${width}px`}
				bg="bg.subtle"
			>
				<HStack
					justify="space-between"
					px="2"
					pt="1.5"
					pb="0"
					borderBottomWidth="1px"
					borderColor="border.subtle"
				>
					<Tabs.Root
						value={tab}
						onValueChange={(e) =>
							setTab(profileId, e.value as GitPanelTab)
						}
						size="sm"
						variant="line"
						flex="1"
					>
						<Tabs.List borderBottomWidth="0">
							<Tabs.Trigger value="changes">Changes</Tabs.Trigger>
							<Tabs.Trigger value="history">History</Tabs.Trigger>
							<Tabs.Trigger value="branches">Branches</Tabs.Trigger>
							<Tabs.Trigger value="stash">Stash</Tabs.Trigger>
						</Tabs.List>
					</Tabs.Root>

					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<IconButton
								aria-label="Close git panel"
								size="2xs"
								variant="ghost"
								onClick={() => setOpen(profileId, false)}
							>
								<FiX />
							</IconButton>
						</Tooltip.Trigger>
						<Portal>
							<Tooltip.Positioner>
								<Tooltip.Content>Close ⌘G</Tooltip.Content>
							</Tooltip.Positioner>
						</Portal>
					</Tooltip.Root>
				</HStack>

				{isRepo && <InProgressBanner profileId={profileId} />}

				{!isRepo ? (
					<InitRepoFlow profileId={profileId} />
				) : tab === "changes" ? (
					<ErrorBoundary
						fallbackRender={({ error, resetErrorBoundary }) => (
							<PanelError
								error={error}
								onRetry={resetErrorBoundary}
							/>
						)}
						resetKeys={[profileId]}
					>
						<Suspense
							fallback={
								<Box p="2" fontSize="sm" color="fg.muted">
									Loading…
								</Box>
							}
						>
							<ChangesTabPane profileId={profileId} />
						</Suspense>
					</ErrorBoundary>
				) : tab === "history" ? (
					<Box flex="1" minH="0" overflow="hidden">
						<GraphLogTab profileId={profileId} />
					</Box>
				) : tab === "branches" ? (
					<Box flex="1" minH="0" overflow="auto" p="2">
						<BranchesTab profileId={profileId} />
					</Box>
				) : (
					<Box flex="1" minH="0" overflow="auto" p="2">
						{tab === "stash" && <StashTab profileId={profileId} />}
					</Box>
				)}
			</Flex>
		</Flex>
	);
}


// Suspense-protected pane that owns the file → diff-tab dispatch. Selecting
// a file in the Changes tab opens a read-only diff in the main editor area
// (via the FileViewerTabs store) instead of cramming it into the panel.
function ChangesTabPane({ profileId }: { profileId: string }) {
	const { data: status } = useGitIndexStatus(profileId);
	const openUntitled = useFileViewerTabsStore((s) => s.openUntitled);

	const sideForPath = useCallback(
		(filePath: string): DiffSide => {
			// If a path appears on both sides (partial staging), prefer
			// unstaged — that's the more common edit target in Fork/IntelliJ.
			if (status.unstaged.some((e) => e.path === filePath)) return "unstaged";
			if (status.staged.some((e) => e.path === filePath)) return "staged";
			return "unstaged";
		},
		[status.staged, status.unstaged],
	);

	const handleSelectFile = useCallback(
		(filePath: string | null) => {
			if (!filePath) return;
			const side = sideForPath(filePath);
			openUntitled(
				profileId,
				buildDiffTabPath(side, filePath),
				diffTabTitle(side, filePath),
			);
		},
		[profileId, openUntitled, sideForPath],
	);

	return (
		<Flex direction="column" flex="1" minH="0">
			<Box flex="1" minH="0" overflow="auto" p="2">
				<ChangesTab
					profileId={profileId}
					selectedPath={null}
					onSelectFile={handleSelectFile}
				/>
			</Box>
			<CommitComposer profileId={profileId} />
		</Flex>
	);
}


function PanelError({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry: () => void;
}) {
	const message = error instanceof Error ? error.message : String(error);
	return (
		<Flex
			direction="column"
			flex="1"
			align="center"
			justify="center"
			p="4"
			gap="2"
		>
			<Box fontSize="sm" color="fg.muted" textAlign="center">
				Couldn't load git state
			</Box>
			<Box
				fontSize="xs"
				color="fg.muted"
				textAlign="center"
				maxWidth="full"
				wordBreak="break-word"
				whiteSpace="pre-wrap"
			>
				{message}
			</Box>
			<button
				type="button"
				onClick={onRetry}
				style={{
					padding: "4px 10px",
					fontSize: "12px",
					border: "1px solid var(--chakra-colors-border-emphasized)",
					borderRadius: "4px",
					background: "transparent",
					color: "inherit",
					cursor: "pointer",
				}}
			>
				Retry
			</button>
		</Flex>
	);
}
