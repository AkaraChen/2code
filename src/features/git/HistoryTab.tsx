// Phase 2.5 minimal History tab.
//
// A flat virtualized commit list — no graph rendering yet (that's Phase 3).
// Per-row: short hash, subject, author, relative date. Click selects.
// Shift/cmd-click for multi-select; right-click opens a context menu.
// Multi-select toolbar surfaces bulk actions (Squash, Edit author/committer).
//
// This is the minimum viable surface to drive the Phase 2.5 rewrite dialogs.
// The real Log/Graph view with composable filters lands in Phase 3.

import {
	Box,
	Button,
	Flex,
	HStack,
	Portal,
	Stack,
	Text,
} from "@chakra-ui/react";
import { Suspense, useCallback, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
	FiCheck,
	FiEdit2,
	FiUser,
} from "react-icons/fi";

import EditMessageDialog from "./EditMessageDialog";
import EditAuthorDialog from "./EditAuthorDialog";
import SquashDialog from "./SquashDialog";
import { buildCommitTabPath, commitTabTitle } from "./diffTabs";
import { useGitLog } from "@/features/git/hooks";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type { GitCommit } from "@/generated";

interface HistoryTabProps {
	profileId: string;
}

export default function HistoryTab({ profileId }: HistoryTabProps) {
	return (
		<HistoryTabBoundary profileId={profileId}>
			<Suspense
				fallback={<Box p="2" fontSize="sm" color="fg.muted">Loading…</Box>}
			>
				<HistoryTabInner profileId={profileId} />
			</Suspense>
		</HistoryTabBoundary>
	);
}

// History tab uses its own ErrorBoundary so a backend failure (e.g.,
// transient git error) doesn't bubble to the panel-level boundary and
// blank the whole panel.
function HistoryTabBoundary({
	profileId,
	children,
}: {
	profileId: string;
	children: React.ReactNode;
}) {
	return (
		<ErrorBoundary
			resetKeys={[profileId]}
			fallbackRender={({ error, resetErrorBoundary }) => (
				<Box p="3" fontSize="xs" color="fg.muted">
					<Box mb="1">Couldn't load history</Box>
					<Box mb="2" wordBreak="break-word">
						{error instanceof Error ? error.message : String(error)}
					</Box>
					<button
						type="button"
						onClick={resetErrorBoundary}
						style={{
							padding: "2px 8px",
							fontSize: "11px",
							border: "1px solid var(--chakra-colors-border-emphasized)",
							borderRadius: "3px",
							background: "transparent",
							color: "inherit",
							cursor: "pointer",
						}}
					>
						Retry
					</button>
				</Box>
			)}
		>
			{children}
		</ErrorBoundary>
	);
}

function HistoryTabInner({ profileId }: HistoryTabProps) {
	const { data: commits } = useGitLog(profileId);
	const [selectedHashes, setSelectedHashes] = useState<Set<string>>(
		new Set(),
	);
	const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
	const [menuFor, setMenuFor] = useState<{
		commit: GitCommit;
		x: number;
		y: number;
	} | null>(null);
	const [editMessageFor, setEditMessageFor] = useState<GitCommit | null>(null);
	const [editAuthorFor, setEditAuthorFor] = useState<GitCommit[] | null>(null);
	const [squashFor, setSquashFor] = useState<GitCommit[] | null>(null);

	const openUntitled = useFileViewerTabsStore((s) => s.openUntitled);

	const openCommitTab = useCallback(
		(selected: GitCommit[]) => {
			if (selected.length === 0) return;
			// Sort oldest → newest using log order (log is newest-first, so
			// reverse the indices). Stable across reselects.
			const indexed = selected
				.map((c) => ({
					c,
					idx: commits.findIndex((cc) => cc.full_hash === c.full_hash),
				}))
				.sort((a, b) => b.idx - a.idx);
			const sorted = indexed.map((i) => i.c);
			const hashes = sorted.map((c) => c.full_hash);
			openUntitled(
				profileId,
				buildCommitTabPath(hashes),
				commitTabTitle(
					hashes,
					sorted.length === 1 ? sorted[0].message : null,
				),
			);
		},
		[commits, openUntitled, profileId],
	);

	const handleRowClick = useCallback(
		(index: number, commit: GitCommit, e: React.MouseEvent) => {
			if (e.shiftKey && anchorIndex !== null) {
				const start = Math.min(anchorIndex, index);
				const end = Math.max(anchorIndex, index);
				const next = new Set<string>();
				for (let i = start; i <= end; i++) {
					next.add(commits[i].full_hash);
				}
				setSelectedHashes(next);
				return;
			}
			if (e.metaKey || e.ctrlKey) {
				setSelectedHashes((prev) => {
					const next = new Set(prev);
					if (next.has(commit.full_hash)) {
						next.delete(commit.full_hash);
					} else {
						next.add(commit.full_hash);
					}
					return next;
				});
				setAnchorIndex(index);
				return;
			}
			// Plain click: single-select + open the commit detail tab.
			setSelectedHashes(new Set([commit.full_hash]));
			setAnchorIndex(index);
			openCommitTab([commit]);
		},
		[anchorIndex, commits, openCommitTab],
	);

	const handleContextMenu = useCallback(
		(commit: GitCommit, e: React.MouseEvent) => {
			e.preventDefault();
			// If the right-clicked commit isn't in the selection, single-select
			// it so menu actions reflect the user's intent.
			if (!selectedHashes.has(commit.full_hash)) {
				setSelectedHashes(new Set([commit.full_hash]));
			}
			setMenuFor({ commit, x: e.clientX, y: e.clientY });
		},
		[selectedHashes],
	);

	const selectedCommits = useMemo(
		() => commits.filter((c) => selectedHashes.has(c.full_hash)),
		[commits, selectedHashes],
	);

	// For squash: selection must be contiguous (a slice of the log).
	const isContiguousSelection = useMemo(() => {
		if (selectedCommits.length < 2) return false;
		const indices = selectedCommits
			.map((c) => commits.findIndex((cc) => cc.full_hash === c.full_hash))
			.sort((a, b) => a - b);
		for (let i = 1; i < indices.length; i++) {
			if (indices[i] !== indices[i - 1] + 1) return false;
		}
		return true;
	}, [selectedCommits, commits]);

	if (commits.length === 0) {
		return (
			<Box p="4" textAlign="center" color="fg.muted" fontSize="sm">
				No commits yet
			</Box>
		);
	}

	return (
		<Flex direction="column" h="full" minH="0">
			{selectedCommits.length > 0 && (
				<HStack
					gap="2"
					px="2"
					py="1.5"
					borderBottomWidth="1px"
					borderColor="border.subtle"
					bg="bg.muted"
					flexShrink={0}
				>
					<Text fontSize="xs" color="fg.muted" flex="1">
						{selectedCommits.length} selected
					</Text>
					{selectedCommits.length >= 2 && (
						<Button
							size="2xs"
							variant="ghost"
							onClick={() => openCommitTab(selectedCommits)}
							title="Open a tab showing the combined changes"
						>
							View commits
						</Button>
					)}
					{selectedCommits.length >= 2 && (
						<Button
							size="2xs"
							variant="ghost"
							disabled={!isContiguousSelection}
							onClick={() => setSquashFor(selectedCommits)}
							title={
								isContiguousSelection
									? "Squash into one"
									: "Squash needs adjacent commits"
							}
						>
							Squash…
						</Button>
					)}
					<Button
						size="2xs"
						variant="ghost"
						onClick={() => setEditAuthorFor(selectedCommits)}
					>
						<FiUser /> Edit identity…
					</Button>
				</HStack>
			)}

			<Box flex="1" minH="0" overflow="auto">
				<Stack gap="0">
					{commits.map((commit, index) => {
						const selected = selectedHashes.has(commit.full_hash);
						return (
							<Flex
								key={commit.full_hash}
								align="center"
								gap="2"
								px="2"
								py="1"
								cursor="pointer"
								bg={selected ? "bg.muted" : "transparent"}
								_hover={{
									bg: selected ? "bg.muted" : "bg.subtle",
								}}
								borderBottomWidth="1px"
								borderColor="border.subtle"
								onClick={(e) => handleRowClick(index, commit, e)}
								onContextMenu={(e) => handleContextMenu(commit, e)}
							>
								<Text
									fontSize="2xs"
									color="fg.muted"
									fontFamily="mono"
									minW="14"
								>
									{commit.hash}
								</Text>
								<Box flex="1" minW="0">
									<Text fontSize="sm" truncate>
										{commit.message}
									</Text>
									<Text fontSize="2xs" color="fg.muted" truncate>
										{commit.author.name} · {formatDate(commit.date)}
									</Text>
								</Box>
								{selected && <FiCheck color="green" />}
							</Flex>
						);
					})}
				</Stack>
			</Box>

			{menuFor && (
				<ContextMenu
					x={menuFor.x}
					y={menuFor.y}
					commit={menuFor.commit}
					selectedCount={selectedCommits.length}
					contiguous={isContiguousSelection}
					onClose={() => setMenuFor(null)}
					onEditMessage={() => {
						setEditMessageFor(menuFor.commit);
						setMenuFor(null);
					}}
					onEditAuthor={() => {
						setEditAuthorFor(
							selectedCommits.length > 0
								? selectedCommits
								: [menuFor.commit],
						);
						setMenuFor(null);
					}}
					onSquash={() => {
						if (isContiguousSelection) {
							setSquashFor(selectedCommits);
							setMenuFor(null);
						}
					}}
				/>
			)}

			{editMessageFor && (
				<EditMessageDialog
					profileId={profileId}
					commit={editMessageFor}
					commits={commits}
					onClose={() => setEditMessageFor(null)}
				/>
			)}
			{editAuthorFor && (
				<EditAuthorDialog
					profileId={profileId}
					commits={editAuthorFor}
					allCommits={commits}
					onClose={() => setEditAuthorFor(null)}
				/>
			)}
			{squashFor && (
				<SquashDialog
					profileId={profileId}
					commits={squashFor}
					allCommits={commits}
					onClose={() => setSquashFor(null)}
				/>
			)}
		</Flex>
	);
}

function ContextMenu({
	x,
	y,
	selectedCount,
	contiguous,
	onClose,
	onEditMessage,
	onEditAuthor,
	onSquash,
}: {
	x: number;
	y: number;
	commit: GitCommit;
	selectedCount: number;
	contiguous: boolean;
	onClose: () => void;
	onEditMessage: () => void;
	onEditAuthor: () => void;
	onSquash: () => void;
}) {
	return (
		<Portal>
			<div
				style={{
					position: "fixed",
					inset: 0,
					zIndex: 1000,
				}}
				onClick={onClose}
				onContextMenu={(e) => {
					e.preventDefault();
					onClose();
				}}
			>
				<div
					style={{
						position: "absolute",
						left: x,
						top: y,
						background: "var(--chakra-colors-bg)",
						border: "1px solid var(--chakra-colors-border-subtle)",
						borderRadius: "6px",
						boxShadow: "0 8px 20px rgba(0,0,0,0.3)",
						minWidth: "200px",
						padding: "4px",
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{selectedCount <= 1 && (
						<MenuItem icon={<FiEdit2 />} onClick={onEditMessage}>
							Edit message…
						</MenuItem>
					)}
					<MenuItem icon={<FiUser />} onClick={onEditAuthor}>
						Edit author/committer…
					</MenuItem>
					{selectedCount >= 2 && (
						<MenuItem
							onClick={contiguous ? onSquash : () => {}}
							disabled={!contiguous}
						>
							Squash{contiguous ? "…" : " (need adjacent)"}
						</MenuItem>
					)}
				</div>
			</div>
		</Portal>
	);
}

function MenuItem({
	children,
	icon,
	onClick,
	disabled,
}: {
	children: React.ReactNode;
	icon?: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={() => !disabled && onClick()}
			disabled={disabled}
			style={{
				display: "flex",
				alignItems: "center",
				gap: "8px",
				width: "100%",
				padding: "6px 10px",
				border: 0,
				background: "transparent",
				color: disabled
					? "var(--chakra-colors-fg-muted)"
					: "inherit",
				cursor: disabled ? "not-allowed" : "pointer",
				fontSize: "13px",
				borderRadius: "4px",
				textAlign: "left",
			}}
			onMouseEnter={(e) => {
				if (!disabled)
					e.currentTarget.style.background =
						"var(--chakra-colors-bg-subtle)";
			}}
			onMouseLeave={(e) => {
				e.currentTarget.style.background = "transparent";
			}}
		>
			{icon}
			{children}
		</button>
	);
}

function formatDate(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const diffMs = Date.now() - d.getTime();
	const day = 24 * 60 * 60 * 1000;
	const days = Math.floor(diffMs / day);
	if (days < 1) {
		const hours = Math.floor(diffMs / (60 * 60 * 1000));
		if (hours < 1) return "just now";
		return `${hours}h ago`;
	}
	if (days < 7) return `${days}d ago`;
	if (days < 30) return `${Math.floor(days / 7)}w ago`;
	return d.toISOString().slice(0, 10);
}
