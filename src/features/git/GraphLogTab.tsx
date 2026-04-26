// Phase 3: virtualized log + graph view.
//
// Replaces the flat HistoryTab list. Each row = [graph canvas | refs |
// subject | author · date]. The graph canvas knows about the previous
// row so it can draw lines that span row boundaries.
//
// Multi-select / context menu / "View commits" are mirrored from
// HistoryTab — eventually we should consolidate, but Phase 3 keeps both
// surfaces side-by-side until the new view is proven out.

import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { FiCheck, FiEdit2, FiUser, FiX } from "react-icons/fi";

import EditAuthorDialog from "./EditAuthorDialog";
import EditMessageDialog from "./EditMessageDialog";
import GraphCanvas from "./GraphCanvas";
import LogFiltersBar from "./LogFiltersBar";
import SquashDialog from "./SquashDialog";
import { buildCommitTabPath, commitTabTitle } from "./diffTabs";
import { useCommitGraph } from "./hooks";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type {
	CommitRef,
	GraphRow,
	LogFilter,
} from "./changesTabBindings";
import type { GitCommit } from "@/generated";

const ROW_HEIGHT = 32;
const GRAPH_WIDTH_BASE = 60; // px before lanes start contributing
const LANE_PIXELS = 14;

interface GraphLogTabProps {
	profileId: string;
}

export default function GraphLogTab({ profileId }: GraphLogTabProps) {
	return (
		<ErrorBoundary
			resetKeys={[profileId]}
			fallbackRender={({ error, resetErrorBoundary }) => (
				<Box p="3" fontSize="xs" color="fg.muted">
					<Box mb="1">Couldn't load log</Box>
					<Box mb="2" wordBreak="break-word">
						{error instanceof Error ? error.message : String(error)}
					</Box>
					<button
						type="button"
						onClick={resetErrorBoundary}
						style={{
							padding: "2px 8px",
							fontSize: "11px",
							border:
								"1px solid var(--chakra-colors-border-emphasized)",
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
			<GraphLogInner profileId={profileId} />
		</ErrorBoundary>
	);
}

function GraphLogInner({ profileId }: { profileId: string }) {
	const [filter, setFilter] = useState<LogFilter>({});
	const { data: rows, isLoading, isFetching } = useCommitGraph(
		profileId,
		filter,
	);

	const graphWidth = useMemo(() => {
		if (!rows || rows.length === 0) return GRAPH_WIDTH_BASE;
		const maxLane = rows.reduce((max, r) => Math.max(max, r.lane), 0);
		return Math.max(GRAPH_WIDTH_BASE, 16 + (maxLane + 1) * LANE_PIXELS);
	}, [rows]);

	const [selectedHashes, setSelectedHashes] = useState<Set<string>>(
		new Set(),
	);
	const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
	const [menuFor, setMenuFor] = useState<{
		row: GraphRow;
		x: number;
		y: number;
	} | null>(null);
	const [editMessageFor, setEditMessageFor] = useState<GitCommit | null>(null);
	const [editAuthorFor, setEditAuthorFor] = useState<GitCommit[] | null>(null);
	const [squashFor, setSquashFor] = useState<GitCommit[] | null>(null);

	const openUntitled = useFileViewerTabsStore((s) => s.openUntitled);

	const openCommitTab = useCallback(
		(selected: GitCommit[]) => {
			if (selected.length === 0 || !rows) return;
			const indexed = selected
				.map((c) => ({
					c,
					idx: rows.findIndex((r) => r.commit.full_hash === c.full_hash),
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
		[rows, openUntitled, profileId],
	);

	const handleRowClick = useCallback(
		(index: number, row: GraphRow, e: React.MouseEvent) => {
			if (!rows) return;
			if (e.shiftKey && anchorIndex !== null) {
				const start = Math.min(anchorIndex, index);
				const end = Math.max(anchorIndex, index);
				const next = new Set<string>();
				for (let i = start; i <= end; i++) {
					next.add(rows[i].commit.full_hash);
				}
				setSelectedHashes(next);
				return;
			}
			if (e.metaKey || e.ctrlKey) {
				setSelectedHashes((prev) => {
					const next = new Set(prev);
					if (next.has(row.commit.full_hash)) {
						next.delete(row.commit.full_hash);
					} else {
						next.add(row.commit.full_hash);
					}
					return next;
				});
				setAnchorIndex(index);
				return;
			}
			setSelectedHashes(new Set([row.commit.full_hash]));
			setAnchorIndex(index);
			openCommitTab([row.commit]);
		},
		[anchorIndex, rows, openCommitTab],
	);

	const handleContextMenu = useCallback(
		(row: GraphRow, e: React.MouseEvent) => {
			e.preventDefault();
			if (!selectedHashes.has(row.commit.full_hash)) {
				setSelectedHashes(new Set([row.commit.full_hash]));
			}
			setMenuFor({ row, x: e.clientX, y: e.clientY });
		},
		[selectedHashes],
	);

	const selectedCommits = useMemo(() => {
		if (!rows) return [];
		return rows
			.filter((r) => selectedHashes.has(r.commit.full_hash))
			.map((r) => r.commit);
	}, [rows, selectedHashes]);

	const isContiguousSelection = useMemo(() => {
		if (!rows || selectedCommits.length < 2) return false;
		const indices = selectedCommits
			.map((c) =>
				rows.findIndex((r) => r.commit.full_hash === c.full_hash),
			)
			.sort((a, b) => a - b);
		for (let i = 1; i < indices.length; i++) {
			if (indices[i] !== indices[i - 1] + 1) return false;
		}
		return true;
	}, [selectedCommits, rows]);

	const scrollRef = useRef<HTMLDivElement | null>(null);
	const virtualizer = useVirtualizer({
		count: rows?.length ?? 0,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_HEIGHT,
		overscan: 12,
	});

	// Esc clears selection — only when there IS one, so dialogs and the
	// context menu (which both have their own Esc handlers) aren't shadowed.
	useEffect(() => {
		if (selectedCommits.length === 0) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Defer to dialogs/menus: skip when something else has focus
			// (input, textarea, dialog).
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.closest("[role='dialog']") ||
					target.closest("[role='menu']"))
			) {
				return;
			}
			setSelectedHashes(new Set());
			setAnchorIndex(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selectedCommits.length]);

	return (
		<Flex direction="column" h="full" minH="0">
			<LogFiltersBar
				value={filter}
				onChange={setFilter}
				loading={isFetching}
			/>

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
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<IconButton
								aria-label="Clear selection"
								size="2xs"
								variant="ghost"
								onClick={() => {
									setSelectedHashes(new Set());
									setAnchorIndex(null);
								}}
							>
								<FiX />
							</IconButton>
						</Tooltip.Trigger>
						<Portal>
							<Tooltip.Positioner>
								<Tooltip.Content>
									Clear selection (Esc)
								</Tooltip.Content>
							</Tooltip.Positioner>
						</Portal>
					</Tooltip.Root>
				</HStack>
			)}

			<Box
				ref={scrollRef}
				flex="1"
				minH="0"
				overflow="auto"
				userSelect="none"
			>
				{isLoading ? (
					<Box p="3" fontSize="sm" color="fg.muted">
						Loading…
					</Box>
				) : !rows || rows.length === 0 ? (
					<Box p="4" textAlign="center" color="fg.muted" fontSize="sm">
						No commits match this filter
					</Box>
				) : (
					<Box
						position="relative"
						width="full"
						style={{ height: virtualizer.getTotalSize() }}
					>
						{virtualizer.getVirtualItems().map((vItem) => {
							const row = rows[vItem.index];
							const selected = selectedHashes.has(
								row.commit.full_hash,
							);
							return (
								<Flex
									key={row.commit.full_hash}
									position="absolute"
									top={0}
									left={0}
									width="full"
									align="center"
									gap="2"
									px="1"
									cursor="pointer"
									bg={selected ? "bg.muted" : "transparent"}
									_hover={{
										bg: selected ? "bg.muted" : "bg.subtle",
									}}
									style={{
										height: ROW_HEIGHT,
										transform: `translateY(${vItem.start}px)`,
									}}
									onClick={(e) =>
										handleRowClick(vItem.index, row, e)
									}
									onContextMenu={(e) =>
										handleContextMenu(row, e)
									}
								>
									<Box
										flexShrink={0}
										style={{ width: graphWidth }}
									>
										<GraphCanvas
											row={row}
											rowHeight={ROW_HEIGHT}
											width={graphWidth}
										/>
									</Box>
									<Text
										fontSize="2xs"
										color="fg.muted"
										fontFamily="mono"
										minW="14"
										flexShrink={0}
									>
										{row.commit.hash}
									</Text>
									<RefChips refs={row.refs} />
									<Box flex="1" minW="0">
										<Text fontSize="sm" truncate>
											{row.commit.message}
										</Text>
									</Box>
									<Text
										fontSize="2xs"
										color="fg.muted"
										flexShrink={0}
									>
										{row.commit.author.name} ·{" "}
										{formatDate(row.commit.date)}
									</Text>
									{row.needs_push && (
										<Box
											title="Not yet pushed"
											style={{
												width: 6,
												height: 6,
												borderRadius: "50%",
												background:
													"var(--chakra-colors-orange-solid, orange)",
												flexShrink: 0,
											}}
										/>
									)}
									{row.signed && (
										<Text
											fontSize="2xs"
											color="green.fg"
											title="Signed"
											flexShrink={0}
										>
											✓
										</Text>
									)}
									{selected && <FiCheck color="green" />}
								</Flex>
							);
						})}
					</Box>
				)}
			</Box>

			{menuFor && (
				<ContextMenu
					x={menuFor.x}
					y={menuFor.y}
					selectedCount={selectedCommits.length}
					contiguous={isContiguousSelection}
					onClose={() => setMenuFor(null)}
					onEditMessage={() => {
						setEditMessageFor(menuFor.row.commit);
						setMenuFor(null);
					}}
					onEditAuthor={() => {
						setEditAuthorFor(
							selectedCommits.length > 0
								? selectedCommits
								: [menuFor.row.commit],
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

			{editMessageFor && rows && (
				<EditMessageDialog
					profileId={profileId}
					commit={editMessageFor}
					commits={rows.map((r) => r.commit)}
					onClose={() => setEditMessageFor(null)}
				/>
			)}
			{editAuthorFor && rows && (
				<EditAuthorDialog
					profileId={profileId}
					commits={editAuthorFor}
					allCommits={rows.map((r) => r.commit)}
					onClose={() => setEditAuthorFor(null)}
				/>
			)}
			{squashFor && rows && (
				<SquashDialog
					profileId={profileId}
					commits={squashFor}
					allCommits={rows.map((r) => r.commit)}
					onClose={() => setSquashFor(null)}
				/>
			)}
		</Flex>
	);
}

function RefChips({ refs }: { refs: CommitRef[] }) {
	if (refs.length === 0) return null;
	return (
		<HStack gap="1" flexShrink={0}>
			{refs.map((r, i) => (
				<RefChip key={`${r.kind}-${i}`} refEntry={r} />
			))}
		</HStack>
	);
}

function RefChip({ refEntry }: { refEntry: CommitRef }) {
	const { label, color } = describeRef(refEntry);
	return (
		<Box
			as="span"
			fontSize="2xs"
			fontFamily="mono"
			px="1.5"
			py="0.5"
			borderRadius="sm"
			bg={color}
			color="fg"
		>
			{label}
		</Box>
	);
}

function describeRef(r: CommitRef): { label: string; color: string } {
	switch (r.kind) {
		case "head":
			return { label: "HEAD", color: "blue.subtle" };
		case "branch":
			return { label: r.name, color: "green.subtle" };
		case "tag":
			return { label: r.name, color: "yellow.subtle" };
		case "remote_branch":
			return { label: r.name, color: "purple.subtle" };
	}
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
				style={{ position: "fixed", inset: 0, zIndex: 1000 }}
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
