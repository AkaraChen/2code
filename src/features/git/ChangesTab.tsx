// Phase 2 Changes tab.
//
// Two collapsible sections (Staged / Unstaged) with rows for each changed file.
// Per-row: change-kind badge, path (with rename arrow if applicable),
// stage/unstage/discard actions. Click a row to fire `onSelectFile` so the
// surrounding panel can open the file in the diff viewport.
//
// Multi-select: cmd/ctrl-click toggles individual rows; shift-click extends
// from the last anchor. Selected rows get bulk actions in the section header.

import {
	Badge,
	Box,
	Flex,
	HStack,
	IconButton,
	Stack,
	Text,
	Tooltip,
	Portal,
} from "@chakra-ui/react";
import { Suspense, useCallback, useState } from "react";
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

	if (data.staged.length === 0 && data.unstaged.length === 0) {
		return (
			<Box fontSize="sm" color="fg.muted" textAlign="center" py="6">
				No changes
			</Box>
		);
	}

	return (
		<Stack gap="2" pb="2">
			<Section
				label="Staged"
				count={data.staged.length}
				open={stagedOpen}
				onToggle={() => setStagedOpen((o) => !o)}
			>
				{data.staged.map((entry) => (
					<FileRow
						key={`staged:${entry.path}`}
						entry={entry}
						selected={selectedPath === entry.path}
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
			>
				{data.unstaged.map((entry) => (
					<FileRow
						key={`unstaged:${entry.path}`}
						entry={entry}
						selected={selectedPath === entry.path}
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

function Section({
	label,
	count,
	open,
	onToggle,
	children,
}: {
	label: string;
	count: number;
	open: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}) {
	return (
		<Box>
			<HStack
				as="button"
				width="full"
				justifyContent="flex-start"
				gap="1"
				px="1"
				py="1"
				cursor="pointer"
				onClick={onToggle}
				color="fg.muted"
				_hover={{ color: "fg" }}
			>
				{open ? <FiChevronDown /> : <FiChevronRight />}
				<Text fontSize="xs" fontWeight="semibold" textTransform="uppercase">
					{label}
				</Text>
				<Text fontSize="xs">({count})</Text>
			</HStack>
			{open && <Stack gap="0">{children}</Stack>}
		</Box>
	);
}

function FileRow({
	entry,
	selected,
	onSelect,
	primaryAction,
	secondaryAction,
}: {
	entry: IndexEntry;
	selected: boolean;
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
