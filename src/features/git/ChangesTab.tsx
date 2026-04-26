// Phase 2 Changes tab.
//
// Two collapsible sections (Staged / Unstaged) with rows for each changed
// file. Per-row: change-kind badge, path (with rename arrow if applicable),
// stage/unstage/discard actions. Click a row to fire `onSelectFile` so the
// surrounding panel can open the file in the diff viewport.
//
// Bulk selection: every row has a checkbox; section headers have a
// tri-state checkbox that selects/deselects the whole section. When any
// file is checked, a bulk-action bar appears at the bottom of that section
// with Stage / Unstage / Discard buttons that operate on the checked set.
// The bulk selection is independent per section (staged vs unstaged) since
// the available actions differ.

import {
	Badge,
	Box,
	Button,
	Checkbox,
	Flex,
	HStack,
	IconButton,
	Stack,
	Text,
	Tooltip,
	Portal,
} from "@chakra-ui/react";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FiChevronDown, FiChevronRight, FiTrash2 } from "react-icons/fi";

import {
	useDiscardGitFileChanges,
	useGitIndexStatus,
	useStageFiles,
	useUnstageFiles,
} from "@/features/git/hooks";
import type {
	GitChangeKind,
	IndexEntry,
} from "@/features/git/changesTabBindings";

interface ChangesTabProps {
	profileId: string;
	selectedPath: string | null;
	onSelectFile: (path: string | null) => void;
}

export default function ChangesTab(props: ChangesTabProps) {
	return (
		<Suspense fallback={<Box fontSize="sm" color="fg.muted">Loading…</Box>}>
			<ChangesTabInner {...props} />
		</Suspense>
	);
}

function ChangesTabInner({
	profileId,
	selectedPath,
	onSelectFile,
}: ChangesTabProps) {
	const { data } = useGitIndexStatus(profileId);
	const stageFiles = useStageFiles(profileId);
	const unstageFiles = useUnstageFiles(profileId);
	const discard = useDiscardGitFileChanges(profileId);

	const [stagedOpen, setStagedOpen] = useState(true);
	const [unstagedOpen, setUnstagedOpen] = useState(true);

	// Per-section bulk-select sets. Keyed by file path. Stored sets may
	// contain stale paths (entries that disappeared after a stage / commit /
	// discard) — we filter them out on read via useMemo so the displayed
	// state always matches reality without a cascading-render effect.
	const [stagedCheckedRaw, setStagedChecked] = useState<Set<string>>(
		() => new Set(),
	);
	const [unstagedCheckedRaw, setUnstagedChecked] = useState<Set<string>>(
		() => new Set(),
	);

	// Track empty/populated transitions so the empty-state crossfade only
	// runs when the state actually flips (e.g. after a commit clears the
	// worktree, or the first edit appears). Without this guard the fade
	// plays on initial mount and on every tab re-entry — frequent paths
	// where animation feels like lag.
	const isEmpty = data.staged.length === 0 && data.unstaged.length === 0;
	const prevEmptyRef = useRef(isEmpty);
	const animateState = prevEmptyRef.current !== isEmpty;
	useEffect(() => {
		prevEmptyRef.current = isEmpty;
	}, [isEmpty]);

	const stagedChecked = useMemo(() => {
		const valid = new Set(data.staged.map((e) => e.path));
		return filterSet(stagedCheckedRaw, valid) ?? stagedCheckedRaw;
	}, [stagedCheckedRaw, data.staged]);

	const unstagedChecked = useMemo(() => {
		const valid = new Set(data.unstaged.map((e) => e.path));
		return filterSet(unstagedCheckedRaw, valid) ?? unstagedCheckedRaw;
	}, [unstagedCheckedRaw, data.unstaged]);

	const stageWholeFile = useCallback(
		(entry: IndexEntry) => {
			stageFiles.mutate({ paths: [entry.path] });
		},
		[stageFiles],
	);

	const unstageWholeFile = useCallback(
		(entry: IndexEntry) => {
			unstageFiles.mutate({ paths: [entry.path] });
		},
		[unstageFiles],
	);

	const discardFile = useCallback(
		(entry: IndexEntry) => {
			discard.mutate({ paths: [entry.path] });
		},
		[discard],
	);

	const togglePathInSet = useCallback(
		(set: Set<string>, path: string) => {
			const next = new Set(set);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		},
		[],
	);

	const stageBulk = useCallback(() => {
		const paths = Array.from(unstagedChecked);
		if (paths.length === 0) return;
		stageFiles.mutate({ paths });
	}, [stageFiles, unstagedChecked]);

	const unstageBulk = useCallback(() => {
		const paths = Array.from(stagedChecked);
		if (paths.length === 0) return;
		unstageFiles.mutate({ paths });
	}, [unstageFiles, stagedChecked]);

	const discardBulk = useCallback(() => {
		const paths = Array.from(unstagedChecked);
		if (paths.length === 0) return;
		discard.mutate({ paths });
	}, [discard, unstagedChecked]);

	if (isEmpty) {
		return (
			<Box
				data-git-state={animateState ? "" : undefined}
				fontSize="sm"
				color="fg.muted"
				textAlign="center"
				py="6"
			>
				No changes
			</Box>
		);
	}

	return (
		<Stack data-git-state={animateState ? "" : undefined} gap="2" pb="2">
			<Section
				label="Staged"
				count={data.staged.length}
				open={stagedOpen}
				onToggle={() => setStagedOpen((o) => !o)}
				headerCheckState={tristate(stagedChecked.size, data.staged.length)}
				onHeaderCheck={(checked) =>
					setStagedChecked(
						checked
							? new Set(data.staged.map((e) => e.path))
							: new Set(),
					)
				}
				bulkActions={
					stagedChecked.size > 0 ? (
						<BulkActionBar
							count={stagedChecked.size}
							onClear={() => setStagedChecked(new Set())}
						>
							<Button
								size="2xs"
								variant="ghost"
								onClick={unstageBulk}
								disabled={unstageFiles.isPending}
							>
								Unstage
							</Button>
						</BulkActionBar>
					) : null
				}
			>
				{data.staged.map((entry) => (
					<FileRow
						key={`staged:${entry.path}`}
						entry={entry}
						selected={selectedPath === entry.path}
						checked={stagedChecked.has(entry.path)}
						onCheckChange={() =>
							setStagedChecked((prev) =>
								togglePathInSet(prev, entry.path),
							)
						}
						onSelect={() => onSelectFile(entry.path)}
						primaryAction={{
							label: "Unstage",
							onClick: () => unstageWholeFile(entry),
							disabled: unstageFiles.isPending,
						}}
					/>
				))}
			</Section>
			<Section
				label="Unstaged"
				count={data.unstaged.length}
				open={unstagedOpen}
				onToggle={() => setUnstagedOpen((o) => !o)}
				headerCheckState={tristate(
					unstagedChecked.size,
					data.unstaged.length,
				)}
				onHeaderCheck={(checked) =>
					setUnstagedChecked(
						checked
							? new Set(data.unstaged.map((e) => e.path))
							: new Set(),
					)
				}
				bulkActions={
					unstagedChecked.size > 0 ? (
						<BulkActionBar
							count={unstagedChecked.size}
							onClear={() => setUnstagedChecked(new Set())}
						>
							<Button
								size="2xs"
								variant="ghost"
								onClick={stageBulk}
								disabled={stageFiles.isPending}
							>
								Stage
							</Button>
							<Button
								size="2xs"
								variant="ghost"
								colorPalette="red"
								onClick={discardBulk}
								disabled={discard.isPending}
							>
								Discard
							</Button>
						</BulkActionBar>
					) : null
				}
			>
				{data.unstaged.map((entry) => (
					<FileRow
						key={`unstaged:${entry.path}`}
						entry={entry}
						selected={selectedPath === entry.path}
						checked={unstagedChecked.has(entry.path)}
						onCheckChange={() =>
							setUnstagedChecked((prev) =>
								togglePathInSet(prev, entry.path),
							)
						}
						onSelect={() => onSelectFile(entry.path)}
						primaryAction={{
							label: "Stage",
							onClick: () => stageWholeFile(entry),
							disabled: stageFiles.isPending,
						}}
						secondaryAction={{
							label: "Discard",
							icon: <FiTrash2 />,
							onClick: () => discardFile(entry),
							disabled: discard.isPending,
						}}
					/>
				))}
			</Section>
		</Stack>
	);
}

type CheckState = "checked" | "unchecked" | "indeterminate";

function tristate(selected: number, total: number): CheckState {
	if (total === 0 || selected === 0) return "unchecked";
	if (selected >= total) return "checked";
	return "indeterminate";
}

/// Drop entries from `set` that aren't in `keep`. Returns null when the
/// result is identical to the input (so callers can no-op the state update).
function filterSet(set: Set<string>, keep: Set<string>): Set<string> | null {
	let removed = false;
	const next = new Set<string>();
	for (const value of set) {
		if (keep.has(value)) {
			next.add(value);
		} else {
			removed = true;
		}
	}
	return removed ? next : null;
}

function Section({
	label,
	count,
	open,
	onToggle,
	headerCheckState,
	onHeaderCheck,
	children,
	bulkActions,
}: {
	label: string;
	count: number;
	open: boolean;
	onToggle: () => void;
	headerCheckState: CheckState;
	onHeaderCheck: (checked: boolean) => void;
	children: React.ReactNode;
	bulkActions?: React.ReactNode;
}) {
	const checked =
		headerCheckState === "checked"
			? true
			: headerCheckState === "indeterminate"
				? "indeterminate"
				: false;

	return (
		<Box>
			<HStack
				width="full"
				justifyContent="flex-start"
				gap="1"
				px="1"
				py="1"
				color="fg.muted"
				_hover={{ color: "fg" }}
			>
				<Checkbox.Root
					size="sm"
					checked={checked}
					onCheckedChange={(e) =>
						onHeaderCheck(e.checked === true)
					}
					disabled={count === 0}
					onClick={(e) => e.stopPropagation()}
				>
					<Checkbox.HiddenInput />
					<Checkbox.Control>
						<Checkbox.Indicator />
					</Checkbox.Control>
				</Checkbox.Root>
				<HStack
					as="button"
					gap="1"
					cursor="pointer"
					onClick={onToggle}
					flex="1"
					justifyContent="flex-start"
				>
					{open ? <FiChevronDown /> : <FiChevronRight />}
					<Text
						fontSize="xs"
						fontWeight="semibold"
						textTransform="uppercase"
					>
						{label}
					</Text>
					<Text fontSize="xs">({count})</Text>
				</HStack>
			</HStack>
			<Box data-git-section-body data-open={open ? "true" : "false"}>
				<Box data-git-section-body-inner>
					<Stack gap="0">{children}</Stack>
					{bulkActions}
				</Box>
			</Box>
		</Box>
	);
}

function BulkActionBar({
	count,
	onClear,
	children,
}: {
	count: number;
	onClear: () => void;
	children: React.ReactNode;
}) {
	// Two-frame mount toggle: the first paint applies the unmounted styles
	// from CSS, the second tick flips data-mounted so the transition runs.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		const id = requestAnimationFrame(() => setMounted(true));
		return () => cancelAnimationFrame(id);
	}, []);
	return (
		<HStack
			data-git-bulk-bar
			data-mounted={mounted ? "true" : "false"}
			gap="2"
			px="2"
			py="1.5"
			mt="1"
			bg="bg.muted"
			borderRadius="sm"
		>
			<Text fontSize="xs" color="fg.muted" flex="1">
				{count} selected
			</Text>
			{children}
			<Button size="2xs" variant="ghost" onClick={onClear}>
				Clear
			</Button>
		</HStack>
	);
}

function FileRow({
	entry,
	selected,
	checked,
	onCheckChange,
	onSelect,
	primaryAction,
	secondaryAction,
}: {
	entry: IndexEntry;
	selected: boolean;
	checked: boolean;
	onCheckChange: () => void;
	onSelect: () => void;
	primaryAction?: {
		label: string;
		onClick: () => void;
		disabled?: boolean;
	};
	secondaryAction?: {
		label: string;
		icon: React.ReactNode;
		onClick: () => void;
		disabled?: boolean;
	};
}) {
	return (
		<Flex
			align="center"
			gap="2"
			px="1.5"
			py="1"
			borderRadius="sm"
			cursor="pointer"
			bg={selected ? "bg.muted" : "transparent"}
			_hover={{ bg: selected ? "bg.muted" : "bg.subtle" }}
			onClick={onSelect}
		>
			<Checkbox.Root
				size="sm"
				checked={checked}
				onCheckedChange={onCheckChange}
				onClick={(e) => e.stopPropagation()}
			>
				<Checkbox.HiddenInput />
				<Checkbox.Control>
					<Checkbox.Indicator />
				</Checkbox.Control>
			</Checkbox.Root>
			<KindBadge kind={entry.kind} />
			<Box flex="1" minW="0">
				<Text
					fontSize="sm"
					truncate
					title={
						entry.original_path
							? `${entry.original_path} → ${entry.path}`
							: entry.path
					}
				>
					{entry.path}
				</Text>
			</Box>
			{primaryAction && (
				<button
					type="button"
					style={{
						background: "transparent",
						border: 0,
						padding: "2px 6px",
						fontSize: "12px",
						color: "var(--chakra-colors-fg-muted)",
						borderRadius: "4px",
						cursor: primaryAction.disabled ? "not-allowed" : "pointer",
					}}
					onClick={(e) => {
						e.stopPropagation();
						if (!primaryAction.disabled) primaryAction.onClick();
					}}
					disabled={primaryAction.disabled}
				>
					{primaryAction.label}
				</button>
			)}
			{secondaryAction && (
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<IconButton
							aria-label={secondaryAction.label}
							size="2xs"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation();
								secondaryAction.onClick();
							}}
							disabled={secondaryAction.disabled}
						>
							{secondaryAction.icon}
						</IconButton>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>{secondaryAction.label}</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>
			)}
		</Flex>
	);
}

const KIND_LABEL: Record<GitChangeKind, { label: string; color: string }> = {
	added: { label: "A", color: "green.subtle" },
	modified: { label: "M", color: "blue.subtle" },
	deleted: { label: "D", color: "red.subtle" },
	renamed: { label: "R", color: "yellow.subtle" },
	copied: { label: "C", color: "purple.subtle" },
	untracked: { label: "?", color: "gray.subtle" },
	type_changed: { label: "T", color: "orange.subtle" },
	unmerged: { label: "U", color: "red.subtle" },
};

function KindBadge({ kind }: { kind: GitChangeKind }) {
	const { label, color } = KIND_LABEL[kind];
	return (
		<Badge
			bg={color}
			fontSize="2xs"
			minW="4"
			textAlign="center"
			variant="subtle"
		>
			{label}
		</Badge>
	);
}
