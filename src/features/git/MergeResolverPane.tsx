// Phase 4 task #45: 3-way merge resolver.
//
// Modal-over-portal containing a Monaco DiffEditor in three-pane mode:
//   left  = ours (HEAD / current branch)
//   right = theirs (the merging-in branch)
//   center = editable result, pre-filled with the worktree contents
//            (which include conflict markers from git's auto-merge)
//
// User edits the center pane until satisfied, clicks "Mark resolved" →
// the contents get written back to disk and `git add`ed, the conflict
// disappears from the InProgressBanner. Ctrl/Cmd+Enter shortcut for
// "mark resolved".

import "@/shared/lib/monaco";

import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Portal,
	Spinner,
	Stack,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { DiffEditor, Editor } from "@monaco-editor/react";
import type { DiffOnMount } from "@monaco-editor/react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FiX } from "react-icons/fi";

import { showGitErrorToast } from "./gitError";
import {
	useConflictState,
	useMarkConflictResolved,
} from "@/features/git/hooks";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { detectMonacoLanguage } from "@/shared/lib/languageDetection";

interface MergeResolverPaneProps {
	profileId: string;
	path: string;
	onClose: () => void;
}

function getMonacoTheme(themeId: string) {
	return themeId.includes("light") ? "light" : "vs-dark";
}

export default function MergeResolverPane({
	profileId,
	path,
	onClose,
}: MergeResolverPaneProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const language = useMemo(() => detectMonacoLanguage(path), [path]);
	const theme = getMonacoTheme(themeId);

	const { data: state, isLoading, error } = useConflictState(profileId, path);
	const markResolved = useMarkConflictResolved(profileId);

	// Editable center pane content. Seeded from `state.current` once the
	// query settles. We hold onto it locally so the user's typing isn't
	// trampled by background watcher invalidations.
	const [resolved, setResolved] = useState<string | null>(null);
	const seededRef = useRef(false);
	// Two-frame mount toggle for the entry animation.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() => setMounted(true));
		return () => cancelAnimationFrame(id);
	}, []);

	useEffect(() => {
		if (state?.current != null && !seededRef.current) {
			setResolved(state.current);
			seededRef.current = true;
		}
	}, [state]);

	const ourMounted: DiffOnMount = useCallback(() => {}, []);

	const handleResolve = useCallback(async () => {
		if (resolved == null) return;
		try {
			await markResolved.mutateAsync({
				path,
				resolvedContents: resolved,
			});
			onClose();
		} catch (e) {
			showGitErrorToast(e);
		}
	}, [resolved, markResolved, path, onClose]);

	// Cmd/Ctrl+Enter to mark resolved.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
				e.preventDefault();
				void handleResolve();
			}
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [handleResolve, onClose]);

	const ours = state?.ours ?? "";
	const theirs = state?.theirs ?? "";
	const center = resolved ?? "";

	const acceptOurs = () => setResolved(ours);
	const acceptTheirs = () => setResolved(theirs);
	const acceptBase = () => setResolved(state?.base ?? "");

	return (
		<Portal>
			<div
				data-git-modal
				data-mounted={mounted ? "true" : "false"}
				style={{
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,0.4)",
					zIndex: 1100,
					display: "flex",
					flexDirection: "column",
				}}
				onClick={onClose}
			>
				<div
					data-git-modal-content
					onClick={(e) => e.stopPropagation()}
					style={{
						margin: "auto",
						background: "var(--chakra-colors-bg)",
						borderRadius: "8px",
						width: "94vw",
						height: "88vh",
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
						boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
					}}
				>
					<HStack
						gap="2"
						px="3"
						py="2"
						borderBottomWidth="1px"
						borderColor="border.subtle"
						flexShrink={0}
					>
						<Text fontWeight="semibold" fontSize="sm">
							Resolve conflict
						</Text>
						<Text fontSize="xs" color="fg.muted" fontFamily="mono">
							{path}
						</Text>
						<Box flex="1" />
						<Tooltip.Root>
							<Tooltip.Trigger asChild>
								<Button
									size="2xs"
									variant="ghost"
									onClick={acceptOurs}
									disabled={state?.ours == null}
								>
									Use ours
								</Button>
							</Tooltip.Trigger>
							<Portal>
								<Tooltip.Positioner>
									<Tooltip.Content>
										Replace center with HEAD's version
									</Tooltip.Content>
								</Tooltip.Positioner>
							</Portal>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger asChild>
								<Button
									size="2xs"
									variant="ghost"
									onClick={acceptTheirs}
									disabled={state?.theirs == null}
								>
									Use theirs
								</Button>
							</Tooltip.Trigger>
							<Portal>
								<Tooltip.Positioner>
									<Tooltip.Content>
										Replace center with the merging-in version
									</Tooltip.Content>
								</Tooltip.Positioner>
							</Portal>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger asChild>
								<Button
									size="2xs"
									variant="ghost"
									onClick={acceptBase}
									disabled={state?.base == null}
								>
									Use base
								</Button>
							</Tooltip.Trigger>
							<Portal>
								<Tooltip.Positioner>
									<Tooltip.Content>
										Replace center with the common ancestor
									</Tooltip.Content>
								</Tooltip.Positioner>
							</Portal>
						</Tooltip.Root>
						<IconButton
							aria-label="Close"
							size="2xs"
							variant="ghost"
							onClick={onClose}
						>
							<FiX />
						</IconButton>
					</HStack>

					{isLoading && (
						<Flex flex="1" align="center" justify="center">
							<Spinner />
						</Flex>
					)}
					{error && (
						<Box p="3" color="red.fg" fontSize="sm">
							{String(error)}
						</Box>
					)}
					{!isLoading && !error && state && (
						<Flex flex="1" minH="0" direction="column">
							{/* Top: ours | theirs side-by-side */}
							<Box flex="1" minH="0" position="relative">
								<DiffEditor
									original={ours}
									modified={theirs}
									language={language}
									theme={theme}
									onMount={ourMounted}
									options={{
										readOnly: true,
										originalEditable: false,
										renderSideBySide: true,
										renderSideBySideInlineBreakpoint: 400,
										useInlineViewWhenSpaceIsLimited: false,
										renderOverviewRuler: false,
										minimap: { enabled: false },
										scrollBeyondLastLine: false,
										automaticLayout: true,
										fontFamily,
										fontSize,
										lineNumbers: "on",
									}}
								/>
								<HeaderLabel left>OURS (HEAD)</HeaderLabel>
								<HeaderLabel right>THEIRS</HeaderLabel>
							</Box>
							{/* Bottom: editable result */}
							<Flex
								direction="column"
								flex="1"
								minH="0"
								borderTopWidth="2px"
								borderColor="border.emphasized"
							>
								<HStack
									gap="2"
									px="3"
									py="1"
									bg="bg.muted"
									flexShrink={0}
								>
									<Text fontSize="xs" fontWeight="semibold">
										RESULT
									</Text>
									<Text fontSize="2xs" color="fg.muted">
										edit until satisfied, then "Mark resolved"
									</Text>
								</HStack>
								<Box flex="1" minH="0">
									<Editor
										value={center}
										onChange={(v) => setResolved(v ?? "")}
										language={language}
										theme={theme}
										options={{
											minimap: { enabled: false },
											scrollBeyondLastLine: false,
											automaticLayout: true,
											fontFamily,
											fontSize,
											lineNumbers: "on",
										}}
									/>
								</Box>
							</Flex>
						</Flex>
					)}

					<HStack
						gap="2"
						px="3"
						py="2"
						borderTopWidth="1px"
						borderColor="border.subtle"
						justify="flex-end"
						flexShrink={0}
					>
						<Stack gap="0" flex="1">
							<Text fontSize="2xs" color="fg.muted">
								Cmd/Ctrl+Enter to mark resolved · Esc to close
							</Text>
						</Stack>
						<Button size="sm" variant="ghost" onClick={onClose}>
							Close
						</Button>
						<Button
							size="sm"
							colorPalette="green"
							onClick={handleResolve}
							disabled={
								resolved == null || markResolved.isPending
							}
							loading={markResolved.isPending}
						>
							Mark resolved
						</Button>
					</HStack>
				</div>
			</div>
		</Portal>
	);
}

function HeaderLabel({
	children,
	left,
	right: _right,
}: {
	children: React.ReactNode;
	left?: boolean;
	right?: boolean;
}) {
	return (
		<Box
			position="absolute"
			top="1"
			{...(left ? { left: "1" } : { right: "1" })}
			fontSize="2xs"
			fontWeight="semibold"
			bg={left ? "blue.subtle" : "purple.subtle"}
			color="fg"
			px="1.5"
			py="0.5"
			borderRadius="sm"
			pointerEvents="none"
			zIndex={1}
		>
			{children}
		</Box>
	);
}
