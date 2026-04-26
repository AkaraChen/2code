// Phase 2.5+ commit detail tab.
//
// Layout:
//   ┌────────── Commit info header ──────────┐
//   │ <hash> · <subject>                     │
//   │ <author> · <date>                      │
//   │ <body, when present>                   │
//   ├──────────┬─────────────────────────────┤
//   │ Files    │ Side-by-side diff for      │
//   │ list     │ the selected file           │
//   │ (left)   │                             │
//   └──────────┴─────────────────────────────┘
//
// Multi-commit selection: union of touched files (latest version wins per
// file), header shows all commits oldest → newest, diff is computed against
// the parent of the OLDEST selected commit so the user sees the full delta
// across the range — not just the last commit's piece. Implemented via the
// backend's `merged_with` parameter.

import {
	Badge,
	Box,
	Flex,
	HStack,
	Spinner,
	Stack,
	Text,
} from "@chakra-ui/react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";

import MonacoSideBySideDiff from "./MonacoSideBySideDiff";
import { parseCommitTabPath } from "./diffTabs";
import { useCommitFileDiffSides, useCommitFiles, useGitLog } from "./hooks";
import type { GitChangeKind, IndexEntry } from "./changesTabBindings";
import type { GitCommit } from "@/generated";

interface CommitDetailPaneProps {
	profileId: string;
	tabPath: string;
}

export default function CommitDetailPane({
	profileId,
	tabPath,
}: CommitDetailPaneProps) {
	const hashes = parseCommitTabPath(tabPath);
	if (!hashes || hashes.length === 0) {
		return (
			<Box p="4" color="fg.muted" fontSize="sm">
				Invalid commit tab: {tabPath}
			</Box>
		);
	}
	return (
		<ErrorBoundary
			resetKeys={[profileId, tabPath]}
			fallbackRender={({ error, resetErrorBoundary }) => (
				<Box p="3" fontSize="xs" color="fg.muted">
					<Box mb="1">Couldn't load commit</Box>
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
			<Suspense
				fallback={
					<Flex align="center" justify="center" h="full">
						<Spinner size="sm" />
					</Flex>
				}
			>
				<CommitDetailInner profileId={profileId} hashes={hashes} />
			</Suspense>
		</ErrorBoundary>
	);
}

function CommitDetailInner({
	profileId,
	hashes,
}: {
	profileId: string;
	hashes: string[];
}) {
	// Resolve commit metadata from the existing log query (which is already
	// loaded for the History tab). For commits outside the log window we
	// fall back to the bare hash.
	const { data: log } = useGitLog(profileId);
	const lookup = useMemo(() => {
		const map = new Map<string, GitCommit>();
		for (const c of log) map.set(c.full_hash, c);
		return map;
	}, [log]);

	// Sort selection oldest → newest using log indices (log is newest-first).
	const sorted = useMemo(() => {
		const indices = hashes.map((h) => ({
			hash: h,
			idx: log.findIndex((c) => c.full_hash === h),
		}));
		// Unknown hashes (idx -1) go to the end; they're rare and just mean
		// the commit is older than the loaded log window.
		indices.sort((a, b) => {
			if (a.idx < 0 && b.idx < 0) return 0;
			if (a.idx < 0) return 1;
			if (b.idx < 0) return -1;
			return b.idx - a.idx;
		});
		return indices.map((i) => i.hash);
	}, [hashes, log]);

	const oldest = sorted[0];
	const newest = sorted[sorted.length - 1];

	const commits = sorted.map((h) => lookup.get(h));

	const [selectedFile, setSelectedFile] = useState<string | null>(null);

	return (
		<Flex direction="column" h="full" minH="0">
			<CommitHeader commits={commits} hashes={sorted} />
			<Flex flex="1" minH="0">
				<Box
					width="280px"
					minW="200px"
					maxW="400px"
					borderInlineEndWidth="1px"
					borderColor="border.subtle"
					overflow="auto"
				>
					<UnionFileList
						profileId={profileId}
						hashes={sorted}
						selectedFile={selectedFile}
						onSelectFile={setSelectedFile}
					/>
				</Box>
				<Box flex="1" minH="0" minW="0">
					{selectedFile ? (
						<CommitFileDiff
							profileId={profileId}
							filePath={selectedFile}
							newestHash={newest}
							oldestHash={oldest}
						/>
					) : (
						<Flex
							align="center"
							justify="center"
							h="full"
							color="fg.muted"
							fontSize="sm"
						>
							Select a file
						</Flex>
					)}
				</Box>
			</Flex>
		</Flex>
	);
}

function CommitHeader({
	commits,
	hashes,
}: {
	commits: Array<GitCommit | undefined>;
	hashes: string[];
}) {
	if (commits.length === 1 && commits[0]) {
		const c = commits[0];
		return (
			<Stack
				gap="1"
				px="3"
				py="2"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				flexShrink={0}
			>
				<HStack gap="2">
					<Text
						fontSize="xs"
						fontFamily="mono"
						color="fg.muted"
					>
						{c.hash}
					</Text>
					<Text fontSize="sm" fontWeight="semibold" truncate>
						{c.message}
					</Text>
				</HStack>
				<Text fontSize="xs" color="fg.muted">
					{c.author.name} &lt;{c.author.email}&gt; · {formatDate(c.date)}
				</Text>
				<Text fontSize="xs" color="fg.muted">
					+{c.insertions} −{c.deletions} across {c.files_changed} file
					{c.files_changed === 1 ? "" : "s"}
				</Text>
			</Stack>
		);
	}

	return (
		<Stack
			gap="1"
			px="3"
			py="2"
			borderBottomWidth="1px"
			borderColor="border.subtle"
			flexShrink={0}
			maxH="180px"
			overflow="auto"
		>
			<Text fontSize="xs" fontWeight="semibold" color="fg.muted">
				{hashes.length} commits — diff against parent of oldest
			</Text>
			{commits.map((c, i) => {
				const hash = hashes[i];
				const short = hash.slice(0, 7);
				return (
					<HStack key={hash} gap="2" fontSize="xs">
						<Text fontFamily="mono" color="fg.muted">
							{short}
						</Text>
						<Text truncate>{c?.message ?? "(out of log range)"}</Text>
						{c && (
							<Text color="fg.muted" flexShrink={0}>
								· {c.author.name} · {formatDate(c.date)}
							</Text>
						)}
					</HStack>
				);
			})}
		</Stack>
	);
}

function UnionFileList({
	profileId,
	hashes,
	selectedFile,
	onSelectFile,
}: {
	profileId: string;
	hashes: string[];
	selectedFile: string | null;
	onSelectFile: (path: string) => void;
}) {
	// Each hash gets its own loader child so we don't violate the rules of
	// hooks (which would happen if we map() over a useCommitFiles call). The
	// children push results into a state map keyed by hash; we aggregate
	// here.
	const [resultsByHash, setResultsByHash] = useState<
		Record<string, IndexEntry[] | null>
	>({});
	const [errorsByHash, setErrorsByHash] = useState<Record<string, unknown>>(
		{},
	);

	const reportResult = useCallback(
		(hash: string, entries: IndexEntry[] | null) => {
			setResultsByHash((prev) =>
				prev[hash] === entries ? prev : { ...prev, [hash]: entries },
			);
		},
		[],
	);
	const reportError = useCallback((hash: string, err: unknown) => {
		setErrorsByHash((prev) => ({ ...prev, [hash]: err }));
	}, []);

	const allLoaded = hashes.every((h) => h in resultsByHash);
	const error = Object.values(errorsByHash)[0];

	const union = useMemo(() => {
		const map = new Map<string, IndexEntry>();
		// Walk hashes in the oldest→newest order so the LAST writer wins —
		// that's the latest version of each file.
		for (const h of hashes) {
			const entries = resultsByHash[h];
			if (!entries) continue;
			for (const entry of entries) {
				map.set(entry.path, entry);
			}
		}
		return Array.from(map.values()).sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}, [hashes, resultsByHash]);

	// Auto-select the first file once results land. Effect (not render-time)
	// so we don't re-trigger on every render.
	useEffect(() => {
		if (!selectedFile && allLoaded && union[0]) {
			onSelectFile(union[0].path);
		}
	}, [selectedFile, allLoaded, union, onSelectFile]);

	// IMPORTANT: always render the CommitFilesLoader children, even while
	// loading or showing an error. Otherwise the loaders never mount and
	// resultsByHash stays empty forever — producing an infinite spinner.
	const loaders = (
		<>
			{hashes.map((h) => (
				<CommitFilesLoader
					key={h}
					profileId={profileId}
					commitHash={h}
					onResult={reportResult}
					onError={reportError}
				/>
			))}
		</>
	);

	let body: React.ReactNode;
	if (error && !allLoaded) {
		body = (
			<Box p="2" fontSize="xs" color="red.fg">
				{String(error)}
			</Box>
		);
	} else if (!allLoaded) {
		body = (
			<Flex align="center" justify="center" h="32">
				<Spinner size="sm" />
			</Flex>
		);
	} else if (union.length === 0) {
		body = (
			<Box p="3" fontSize="xs" color="fg.muted">
				No files in this commit
			</Box>
		);
	} else {
		body = (
			<Stack gap="0" py="1">
				{union.map((entry) => {
					const selected = entry.path === selectedFile;
					return (
						<Flex
							key={entry.path}
							align="center"
							gap="2"
							px="2"
							py="1"
							cursor="pointer"
							bg={selected ? "bg.muted" : "transparent"}
							_hover={{ bg: selected ? "bg.muted" : "bg.subtle" }}
							onClick={() => onSelectFile(entry.path)}
						>
							<KindBadge kind={entry.kind} />
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
						</Flex>
					);
				})}
			</Stack>
		);
	}

	return (
		<>
			{loaders}
			{body}
		</>
	);
}

// Tiny invisible component: subscribes to one commit's file list via the
// hook and reports it to the parent. Keeps the parent's hook count stable
// regardless of selection size.
function CommitFilesLoader({
	profileId,
	commitHash,
	onResult,
	onError,
}: {
	profileId: string;
	commitHash: string;
	onResult: (hash: string, entries: IndexEntry[] | null) => void;
	onError: (hash: string, err: unknown) => void;
}) {
	const { data, error } = useCommitFiles(profileId, commitHash);
	useEffect(() => {
		if (data) onResult(commitHash, data);
	}, [data, commitHash, onResult]);
	useEffect(() => {
		if (error) onError(commitHash, error);
	}, [error, commitHash, onError]);
	return null;
}

function CommitFileDiff({
	profileId,
	filePath,
	newestHash,
	oldestHash,
}: {
	profileId: string;
	filePath: string;
	newestHash: string;
	oldestHash: string;
}) {
	// `merged_with` is the OLDEST commit, so the original side comes from
	// its parent. When only one commit is selected, oldest === newest and
	// the param has no effect.
	const mergedWith = newestHash === oldestHash ? null : oldestHash;

	const { data, isLoading, error } = useCommitFileDiffSides(
		profileId,
		newestHash,
		filePath,
		mergedWith,
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
				color="fg.muted"
				fontSize="sm"
				p="4"
			>
				File is too large to diff in this view.
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
				Binary file
			</Flex>
		);
	}

	return (
		<MonacoSideBySideDiff
			filePath={filePath}
			original={data.original ?? ""}
			modified={data.modified ?? ""}
			mode="side-by-side"
		/>
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
