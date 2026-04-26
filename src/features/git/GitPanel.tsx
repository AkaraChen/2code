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
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { FiX } from "react-icons/fi";

import ChangesTab from "./ChangesTab";
import ChangesDiffPane from "./ChangesDiffPane";
import CommitComposer from "./CommitComposer";
import HistoryTab from "./HistoryTab";
import { useGitPanelStore, type GitPanelTab } from "./gitPanelStore";

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

	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	// Drag-to-resize handle. Mouse down starts a drag; mouse move resizes;
	// mouse up commits. Uses requestAnimationFrame to coalesce rapid moves.
	const dragRef = useRef<{
		startX: number;
		startWidth: number;
		raf?: number;
	} | null>(null);

	const onMouseMove = useCallback(
		(e: MouseEvent) => {
			if (!dragRef.current) return;
			const drag = dragRef.current;
			if (drag.raf) return;
			drag.raf = requestAnimationFrame(() => {
				if (!dragRef.current) return;
				const dx = drag.startX - e.clientX; // dragging left grows panel
				setWidth(drag.startWidth + dx);
				drag.raf = undefined;
			});
		},
		[setWidth],
	);

	const stopDrag = useCallback(() => {
		dragRef.current = null;
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		window.removeEventListener("mousemove", onMouseMove);
		window.removeEventListener("mouseup", stopDrag);
	}, [onMouseMove]);

	const startDrag = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			dragRef.current = { startX: e.clientX, startWidth: width };
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("mousemove", onMouseMove);
			window.addEventListener("mouseup", stopDrag);
		},
		[width, onMouseMove, stopDrag],
	);

	useEffect(() => {
		// Defensive cleanup in case the component unmounts mid-drag.
		return () => stopDrag();
	}, [stopDrag]);

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

				{tab === "changes" ? (
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
							<Flex direction="column" flex="1" minH="0">
								<Box
									flex={selectedPath ? "0 0 35%" : "1"}
									minH="0"
									overflow="auto"
									p="2"
									borderBottomWidth={selectedPath ? "1px" : "0"}
									borderColor="border.subtle"
								>
									<ChangesTab
										profileId={profileId}
										selectedPath={selectedPath}
										onSelectFile={setSelectedPath}
									/>
								</Box>
								{selectedPath && (
									<Box flex="1" minH="0">
										<ChangesDiffPane
											profileId={profileId}
											filePath={selectedPath}
											onClose={() => setSelectedPath(null)}
										/>
									</Box>
								)}
								<CommitComposer profileId={profileId} />
							</Flex>
						</Suspense>
					</ErrorBoundary>
				) : tab === "history" ? (
					<Box flex="1" minH="0" overflow="hidden">
						<HistoryTab profileId={profileId} />
					</Box>
				) : (
					<Box flex="1" minH="0" overflow="auto" p="2">
						{tab === "branches" && (
							<SoonPlaceholder label="Branches — Phase 4" />
						)}
						{tab === "stash" && <SoonPlaceholder label="Stash — Phase 4" />}
					</Box>
				)}
			</Flex>
		</Flex>
	);
}

function SoonPlaceholder({ label }: { label: string }) {
	return (
		<Box fontSize="sm" color="fg.muted">
			{label}
		</Box>
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
