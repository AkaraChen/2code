// Phase 4 task #37 + #39: file-tree-style branches/remotes/tags view.
//
// Three collapsible sections render under the GitPanel "Branches" tab:
//   - Local      → BranchInfo[]  (slash-separated names group into folders)
//   - Remotes    → grouped by remote name; each remote's branches are a
//                  sub-tree under its name (e.g. "origin/feat/auth/login"
//                  → origin/ → feat/ → auth/ → login)
//   - Tags       → TagInfo[] (also slash-grouped, e.g. "release/v1.2.0")
//
// Per-row affordances:
//   - Local branches: star + bold for current; ahead/behind chips
//   - Click a leaf → selects + opens its commit detail tab (uses the
//     existing Phase 2.5+ tab path scheme via openCommitTab)
//   - Right-click leaf → context menu (Checkout / New from / Rename / Delete)
//
// Folder rows toggle expand/collapse. Folder open state is component-local
// and resets on tab close — fine for v1; persist to gitPanelStore later if
// users complain.

import {
	Box,
	Button,
	Field,
	Flex,
	HStack,
	IconButton,
	Input,
	Portal,
	Spinner,
	Stack,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import {
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
	FiChevronDown,
	FiChevronRight,
	FiCornerDownRight,
	FiDownload,
	FiDownloadCloud,
	FiEdit2,
	FiGitBranch,
	FiGitMerge,
	FiPlus,
	FiRefreshCw,
	FiStar,
	FiTag,
	FiTrash2,
	FiUpload,
} from "react-icons/fi";

import RewriteDialogShell from "./RewriteDialogShell";
import { buildCommitTabPath, commitTabTitle } from "./diffTabs";
import { buildBranchTree, type BranchTreeNode } from "./branchTree";
import {
	useCheckoutBranch,
	useCreateBranch,
	useDeleteBranch,
	useGitBranches,
	useGitDeleteRemoteBranch,
	useGitFetch,
	useGitMergeRef,
	useGitPull,
	useGitPushWithLease,
	useGitRebaseOnto,
	useGitRemoteBranches,
	useGitRemotes,
	useGitRenameRemoteBranch,
	useGitTags,
	useRenameBranch,
} from "@/features/git/hooks";
import { showGitErrorToast } from "@/features/git/gitError";
import type {
	BranchInfo,
	RemoteBranchInfo,
	RemoteInfo,
	TagInfo,
} from "@/features/git/changesTabBindings";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";

interface BranchesTabProps {
	profileId: string;
}

export default function BranchesTab({ profileId }: BranchesTabProps) {
	return (
		<ErrorBoundary
			resetKeys={[profileId]}
			fallbackRender={({ error, resetErrorBoundary }) => (
				<Box p="3" fontSize="xs" color="fg.muted">
					<Box mb="1">Couldn't load branches</Box>
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
					<Flex align="center" justify="center" h="32">
						<Spinner size="sm" />
					</Flex>
				}
			>
				<BranchesInner profileId={profileId} />
			</Suspense>
		</ErrorBoundary>
	);
}

function BranchesInner({ profileId }: { profileId: string }) {
	const { data: branches } = useGitBranches(profileId);
	const { data: remotes } = useGitRemotes(profileId);
	const { data: remoteBranches } = useGitRemoteBranches(profileId);
	const { data: tags } = useGitTags(profileId);

	// Auto-fetch on first mount per profile so a fresh clone (or a long-idle
	// repo) shows up-to-date remote branches without the user clicking
	// "Fetch". Errors are swallowed — no network is a normal state and we
	// don't want a toast every time the user opens the panel offline.
	useAutoFetchOnce(profileId);

	const localTree = useMemo(
		() => buildBranchTree(branches ?? [], (b) => b.name),
		[branches],
	);

	// Group remote-tracking branches by remote name so each remote in the
	// "Remotes" section expands into its own slash-grouped tree (e.g.
	// origin → feat/ → auth/ → login).
	const remoteBranchesByRemote = useMemo(() => {
		const map = new Map<string, RemoteBranchInfo[]>();
		for (const rb of remoteBranches ?? []) {
			const list = map.get(rb.remote) ?? [];
			list.push(rb);
			map.set(rb.remote, list);
		}
		return map;
	}, [remoteBranches]);

	const tagTree = useMemo(
		() => buildBranchTree(tags ?? [], (t) => t.name),
		[tags],
	);

	const [localOpen, setLocalOpen] = useState(true);
	const [remotesOpen, setRemotesOpen] = useState(true);
	const [tagsOpen, setTagsOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);

	// Both local and remote branch rows share one context menu. The target
	// is a discriminated union so the menu can render the same six actions
	// while dispatching to local-vs-remote-flavored dialogs underneath.
	const [menu, setMenu] = useState<{
		target: BranchTarget;
		x: number;
		y: number;
	} | null>(null);

	const [deleteFor, setDeleteFor] = useState<BranchInfo | null>(null);
	const [renameFor, setRenameFor] = useState<BranchInfo | null>(null);
	const [createFromBranch, setCreateFromBranch] =
		useState<BranchInfo | null>(null);

	const [deleteRemoteFor, setDeleteRemoteFor] =
		useState<RemoteBranchInfo | null>(null);
	const [renameRemoteFor, setRenameRemoteFor] =
		useState<RemoteBranchInfo | null>(null);
	// Rebase / merge dialogs work the same for local and remote targets — the
	// only difference is the ref string we pass to git.
	const [confirmRebaseFor, setConfirmRebaseFor] = useState<{
		ref: string;
		label: string;
	} | null>(null);
	const [confirmMergeFor, setConfirmMergeFor] = useState<{
		ref: string;
		label: string;
	} | null>(null);

	const currentBranchName = branches?.find((b) => b.is_current)?.name ?? null;

	const openUntitled = useFileViewerTabsStore((s) => s.openUntitled);
	const openCommitTab = useCallback(
		(branch: BranchInfo) => {
			openUntitled(
				profileId,
				buildCommitTabPath([branch.last_commit_hash]),
				commitTabTitle(
					[branch.last_commit_hash],
					branch.last_commit_subject,
				),
			);
		},
		[profileId, openUntitled],
	);

	return (
		<Stack gap="2" pb="2">
			<Section
				icon={<FiGitBranch />}
				label="Local"
				count={branches?.length ?? 0}
				open={localOpen}
				onToggle={() => setLocalOpen((v) => !v)}
				rightSlot={
					<RemoteOpsToolbar
						profileId={profileId}
						currentBranch={
							branches?.find((b) => b.is_current) ?? null
						}
						onCreate={() => {
							setCreateFromBranch(null);
							setCreateOpen(true);
						}}
					/>
				}
			>
				{localOpen && (
					<TreeRender<BranchInfo>
						nodes={localTree}
						depth={0}
						renderLeaf={(node) => (
							<BranchLeafRow
								branch={node.value}
								onClick={() => openCommitTab(node.value)}
								onContextMenu={(e) =>
									setMenu({
										target: { kind: "local", branch: node.value },
										x: e.clientX,
										y: e.clientY,
									})
								}
							/>
						)}
					/>
				)}
			</Section>

			<Section
				icon={<FiGitBranch />}
				label="Remotes"
				count={remoteBranches?.length ?? remotes?.length ?? 0}
				open={remotesOpen}
				onToggle={() => setRemotesOpen((v) => !v)}
			>
				{remotesOpen && (
					<Stack gap="0">
						{(remotes ?? []).map((r) => (
							<RemoteGroup
								key={r.name}
								remote={r}
								branches={
									remoteBranchesByRemote.get(r.name) ?? []
								}
								onSelectBranch={(rb) =>
									openCommitTab({
										last_commit_hash: rb.last_commit_hash,
										last_commit_subject:
											rb.last_commit_subject,
									} as BranchInfo)
								}
								onContextMenu={(rb, e) =>
									setMenu({
										target: { kind: "remote", rb },
										x: e.clientX,
										y: e.clientY,
									})
								}
							/>
						))}
						{(remotes?.length ?? 0) === 0 && (
							<Text fontSize="xs" color="fg.muted" px="2" py="1">
								No remotes
							</Text>
						)}
					</Stack>
				)}
			</Section>

			<Section
				icon={<FiTag />}
				label="Tags"
				count={tags?.length ?? 0}
				open={tagsOpen}
				onToggle={() => setTagsOpen((v) => !v)}
			>
				{tagsOpen && (
					<TreeRender<TagInfo>
						nodes={tagTree}
						depth={0}
						renderLeaf={(node) => <TagLeafRow tag={node.value} />}
					/>
				)}
			</Section>

			{menu && (
				<BranchContextMenu
					x={menu.x}
					y={menu.y}
					target={menu.target}
					profileId={profileId}
					currentBranchName={currentBranchName}
					onClose={() => setMenu(null)}
					onCreateFrom={() => {
						const startName =
							menu.target.kind === "local"
								? menu.target.branch.name
								: menu.target.rb.name;
						setCreateFromBranch({ name: startName } as BranchInfo);
						setCreateOpen(true);
						setMenu(null);
					}}
					onRename={() => {
						if (menu.target.kind === "local") {
							setRenameFor(menu.target.branch);
						} else {
							setRenameRemoteFor(menu.target.rb);
						}
						setMenu(null);
					}}
					onDelete={() => {
						if (menu.target.kind === "local") {
							setDeleteFor(menu.target.branch);
						} else {
							setDeleteRemoteFor(menu.target.rb);
						}
						setMenu(null);
					}}
					onRebase={() => {
						const ref =
							menu.target.kind === "local"
								? menu.target.branch.name
								: menu.target.rb.name;
						setConfirmRebaseFor({ ref, label: ref });
						setMenu(null);
					}}
					onMerge={() => {
						const ref =
							menu.target.kind === "local"
								? menu.target.branch.name
								: menu.target.rb.name;
						setConfirmMergeFor({ ref, label: ref });
						setMenu(null);
					}}
				/>
			)}

			{createOpen && (
				<CreateBranchDialog
					profileId={profileId}
					startPoint={createFromBranch?.name ?? null}
					onClose={() => {
						setCreateOpen(false);
						setCreateFromBranch(null);
					}}
				/>
			)}

			{deleteFor && (
				<DeleteBranchDialog
					profileId={profileId}
					branch={deleteFor}
					onClose={() => setDeleteFor(null)}
				/>
			)}

			{renameFor && (
				<RenameBranchDialog
					profileId={profileId}
					branch={renameFor}
					onClose={() => setRenameFor(null)}
				/>
			)}

			{deleteRemoteFor && (
				<DeleteRemoteBranchDialog
					profileId={profileId}
					rb={deleteRemoteFor}
					onClose={() => setDeleteRemoteFor(null)}
				/>
			)}

			{renameRemoteFor && (
				<RenameRemoteBranchDialog
					profileId={profileId}
					rb={renameRemoteFor}
					onClose={() => setRenameRemoteFor(null)}
				/>
			)}

			{confirmRebaseFor && (
				<ConfirmRebaseDialog
					profileId={profileId}
					targetRef={confirmRebaseFor.ref}
					targetLabel={confirmRebaseFor.label}
					currentBranchName={currentBranchName}
					onClose={() => setConfirmRebaseFor(null)}
				/>
			)}

			{confirmMergeFor && (
				<ConfirmMergeDialog
					profileId={profileId}
					targetRef={confirmMergeFor.ref}
					targetLabel={confirmMergeFor.label}
					currentBranchName={currentBranchName}
					onClose={() => setConfirmMergeFor(null)}
				/>
			)}
		</Stack>
	);
}

type BranchTarget =
	| { kind: "local"; branch: BranchInfo }
	| { kind: "remote"; rb: RemoteBranchInfo };

// ── Section + tree-render primitives ──

function Section({
	icon,
	label,
	count,
	open,
	onToggle,
	children,
	rightSlot,
}: {
	icon: React.ReactNode;
	label: string;
	count: number;
	open: boolean;
	onToggle: () => void;
	children: React.ReactNode;
	rightSlot?: React.ReactNode;
}) {
	return (
		<Box>
			<HStack
				width="full"
				gap="1"
				px="1"
				py="1"
				color="fg.muted"
				_hover={{ color: "fg" }}
			>
				<HStack
					as="button"
					gap="1"
					cursor="pointer"
					onClick={onToggle}
					flex="1"
					justifyContent="flex-start"
				>
					{open ? <FiChevronDown /> : <FiChevronRight />}
					{icon}
					<Text
						fontSize="xs"
						fontWeight="semibold"
						textTransform="uppercase"
					>
						{label}
					</Text>
					<Text fontSize="xs">({count})</Text>
				</HStack>
				{rightSlot}
			</HStack>
			{children}
		</Box>
	);
}

function TreeRender<T>({
	nodes,
	depth,
	renderLeaf,
}: {
	nodes: BranchTreeNode<T>[];
	depth: number;
	renderLeaf: (node: { kind: "leaf"; name: string; path: string; value: T }) => React.ReactNode;
}) {
	return (
		<Stack gap="0">
			{nodes.map((node) => (
				<TreeNodeRender
					key={node.path}
					node={node}
					depth={depth}
					renderLeaf={renderLeaf}
				/>
			))}
		</Stack>
	);
}

function TreeNodeRender<T>({
	node,
	depth,
	renderLeaf,
}: {
	node: BranchTreeNode<T>;
	depth: number;
	renderLeaf: (node: { kind: "leaf"; name: string; path: string; value: T }) => React.ReactNode;
}) {
	const [open, setOpen] = useState(true);

	if (node.kind === "leaf") {
		return (
			<Box style={{ paddingLeft: 8 + depth * 12 }}>
				{renderLeaf(node)}
			</Box>
		);
	}

	return (
		<Box>
			<HStack
				as="button"
				gap="1"
				cursor="pointer"
				py="0.5"
				borderRadius="sm"
				_hover={{ bg: "bg.subtle" }}
				onClick={() => setOpen((v) => !v)}
				width="full"
				justifyContent="flex-start"
				style={{ paddingLeft: 4 + depth * 12 }}
			>
				{open ? (
					<FiChevronDown size={12} />
				) : (
					<FiChevronRight size={12} />
				)}
				<Text fontSize="sm" color="fg.muted">
					{node.name}
				</Text>
			</HStack>
			{open && (
				<TreeRender
					nodes={node.children}
					depth={depth + 1}
					renderLeaf={renderLeaf}
				/>
			)}
		</Box>
	);
}

// ── Leaf rows ──

function BranchLeafRow({
	branch,
	onClick,
	onContextMenu,
}: {
	branch: BranchInfo;
	onClick: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}) {
	return (
		<Flex
			align="center"
			gap="2"
			px="1.5"
			py="0.5"
			borderRadius="sm"
			cursor="pointer"
			_hover={{ bg: "bg.subtle" }}
			onClick={onClick}
			onContextMenu={(e) => {
				e.preventDefault();
				onContextMenu(e);
			}}
		>
			{branch.is_current ? (
				<FiStar color="orange" size={12} />
			) : (
				<Box style={{ width: 12, flexShrink: 0 }} />
			)}
			<Text
				fontSize="sm"
				flex="1"
				truncate
				fontWeight={branch.is_current ? "semibold" : undefined}
				title={branch.name}
			>
				{branch.name}
			</Text>
			{branch.upstream && (
				<HStack gap="1">
					{branch.ahead > 0 && (
						<Text fontSize="2xs" color="green.fg">
							↑{branch.ahead}
						</Text>
					)}
					{branch.behind > 0 && (
						<Text fontSize="2xs" color="red.fg">
							↓{branch.behind}
						</Text>
					)}
				</HStack>
			)}
		</Flex>
	);
}

// Per-profile guard so the auto-fetch doesn't re-run on every render. We
// gate by a module-level Set rather than useRef because the panel can
// remount across tab switches but we still want only one fetch per session.
const autoFetchedProfiles = new Set<string>();

function useAutoFetchOnce(profileId: string) {
	const fetcher = useGitFetch(profileId);
	const startedRef = useRef(false);
	useEffect(() => {
		if (startedRef.current) return;
		if (autoFetchedProfiles.has(profileId)) return;
		startedRef.current = true;
		autoFetchedProfiles.add(profileId);
		// fire-and-forget — failures are silent (offline, no remote, auth
		// prompt, etc.). The visible "Fetch" button gives users an explicit
		// retry path with toasts.
		fetcher.mutate(
			{ remote: null },
			{
				onError: () => {
					// Allow a future remount to retry once the env changes.
					autoFetchedProfiles.delete(profileId);
				},
			},
		);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profileId]);
}

function RemoteGroup({
	remote,
	branches,
	onSelectBranch,
	onContextMenu,
}: {
	remote: RemoteInfo;
	branches: RemoteBranchInfo[];
	onSelectBranch: (rb: RemoteBranchInfo) => void;
	onContextMenu: (rb: RemoteBranchInfo, e: React.MouseEvent) => void;
}) {
	const [open, setOpen] = useState(true);
	const tree = useMemo(
		() => buildBranchTree(branches, (b) => b.branch),
		[branches],
	);
	return (
		<Box>
			<HStack
				as="button"
				width="full"
				gap="1"
				px="1"
				py="0.5"
				cursor="pointer"
				_hover={{ bg: "bg.subtle" }}
				borderRadius="sm"
				onClick={() => setOpen((v) => !v)}
				title={remote.url}
			>
				{open ? <FiChevronDown /> : <FiChevronRight />}
				<FiGitBranch />
				<Text fontSize="sm" fontWeight="medium" truncate>
					{remote.name}
				</Text>
				<Text fontSize="2xs" color="fg.muted">
					{branches.length}
				</Text>
				<Box flex="1" />
				<Text
					fontSize="2xs"
					color="fg.muted"
					maxW="40%"
					truncate
					textAlign="right"
				>
					{remote.url}
				</Text>
			</HStack>
			{open && (
				<TreeRender<RemoteBranchInfo>
					nodes={tree}
					depth={0}
					renderLeaf={(node) => (
						<RemoteBranchLeafRow
							rb={node.value}
							onClick={() => onSelectBranch(node.value)}
							onContextMenu={(e) => onContextMenu(node.value, e)}
						/>
					)}
				/>
			)}
			{branches.length === 0 && open && (
				<Text fontSize="xs" color="fg.muted" pl="6" py="1">
					No remote branches — try Fetch
				</Text>
			)}
		</Box>
	);
}

function RemoteBranchLeafRow({
	rb,
	onClick,
	onContextMenu,
}: {
	rb: RemoteBranchInfo;
	onClick: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
}) {
	return (
		<Flex
			align="center"
			gap="2"
			px="1.5"
			py="0.5"
			borderRadius="sm"
			cursor="pointer"
			_hover={{ bg: "bg.subtle" }}
			onClick={onClick}
			onContextMenu={(e) => {
				e.preventDefault();
				onContextMenu(e);
			}}
			title={rb.name}
		>
			<Box style={{ width: 12, flexShrink: 0 }} />
			<Text fontSize="sm" flex="1" truncate>
				{rb.branch}
			</Text>
		</Flex>
	);
}

function TagLeafRow({ tag }: { tag: TagInfo }) {
	return (
		<Flex
			align="center"
			gap="2"
			px="1.5"
			py="0.5"
			borderRadius="sm"
			_hover={{ bg: "bg.subtle" }}
			title={tag.message ?? undefined}
		>
			<Box style={{ width: 12, flexShrink: 0 }} />
			<Text fontSize="sm" flex="1" truncate>
				{tag.name}
			</Text>
			{tag.is_annotated && (
				<Text fontSize="2xs" color="fg.muted">
					annotated
				</Text>
			)}
		</Flex>
	);
}

// ── Context menu + dialogs ──

// Unified context menu for both local and remote branch rows. The action
// list is identical; only the underlying dialog/op flavor differs (the
// caller picks via the `target` discriminator in setMenu).
function BranchContextMenu({
	x,
	y,
	target,
	profileId,
	currentBranchName,
	onClose,
	onCreateFrom,
	onRename,
	onDelete,
	onRebase,
	onMerge,
}: {
	x: number;
	y: number;
	target: BranchTarget;
	profileId: string;
	currentBranchName: string | null;
	onClose: () => void;
	onCreateFrom: () => void;
	onRename: () => void;
	onDelete: () => void;
	onRebase: () => void;
	onMerge: () => void;
}) {
	const checkout = useCheckoutBranch(profileId);

	// For local: checkout the branch by its own name.
	// For remote: checkout `<branch>` (the part after "<remote>/") — git
	// auto-creates a tracking branch when the name is unambiguous.
	const checkoutName =
		target.kind === "local" ? target.branch.name : target.rb.branch;
	const displayName =
		target.kind === "local" ? target.branch.name : target.rb.name;

	// "Already on this branch": local sets is_current; for a remote ref
	// we treat it as on-this-branch when the local current matches the
	// remote's branch portion (rebase/merge into yourself is a no-op).
	const onThisBranch =
		target.kind === "local"
			? target.branch.is_current
			: currentBranchName != null && currentBranchName === target.rb.branch;

	const handleCheckout = async () => {
		try {
			await checkout.mutateAsync({ branch: checkoutName });
			onClose();
		} catch (e) {
			showGitErrorToast(e);
			onClose();
		}
	};

	const noCurrent = currentBranchName == null;

	const renameLabel =
		target.kind === "local" ? "Rename…" : "Rename on remote…";
	const deleteLabel =
		target.kind === "local" ? "Delete…" : "Delete on remote…";

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
						minWidth: "260px",
						padding: "4px",
					}}
					onClick={(e) => e.stopPropagation()}
				>
					{!onThisBranch && (
						<MenuItem
							icon={<FiGitBranch />}
							onClick={handleCheckout}
						>
							Checkout {checkoutName}
						</MenuItem>
					)}
					<MenuItem icon={<FiPlus />} onClick={onCreateFrom}>
						New branch from this…
					</MenuItem>
					<MenuItem
						icon={<FiCornerDownRight />}
						onClick={onRebase}
						disabled={noCurrent || onThisBranch}
					>
						Rebase {currentBranchName ?? "current"} onto this
					</MenuItem>
					<MenuItem
						icon={<FiGitMerge />}
						onClick={onMerge}
						disabled={noCurrent || onThisBranch}
					>
						Merge into {currentBranchName ?? "current"}
					</MenuItem>
					<MenuItem icon={<FiEdit2 />} onClick={onRename}>
						{renameLabel}
					</MenuItem>
					{!onThisBranch && (
						<MenuItem
							icon={<FiTrash2 />}
							onClick={onDelete}
							danger
						>
							{deleteLabel}
						</MenuItem>
					)}
					<Box pt="1" pl="2" pr="2">
						<Text fontSize="2xs" color="fg.muted" truncate>
							{displayName}
						</Text>
					</Box>
				</div>
			</div>
		</Portal>
	);
}

function MenuItem({
	icon,
	children,
	onClick,
	disabled,
	danger,
}: {
	icon?: React.ReactNode;
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
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
					: danger
						? "var(--chakra-colors-red-fg)"
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

function CreateBranchDialog({
	profileId,
	startPoint,
	onClose,
}: {
	profileId: string;
	startPoint: string | null;
	onClose: () => void;
}) {
	const create = useCreateBranch(profileId);
	const checkout = useCheckoutBranch(profileId);
	const [name, setName] = useState("");
	const [checkoutAfter, setCheckoutAfter] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		setError(null);
		const trimmed = name.trim();
		if (!trimmed) return;
		try {
			await create.mutateAsync({ name: trimmed, startPoint });
			if (checkoutAfter) {
				try {
					await checkout.mutateAsync({ branch: trimmed });
				} catch (e) {
					setError(e instanceof Error ? e.message : String(e));
					return;
				}
			}
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title="New branch"
			onClose={onClose}
			submitting={create.isPending || checkout.isPending}
			submitDisabled={!name.trim() || create.isPending}
			submitLabel="Create"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Field.Root>
					<Field.Label>Name</Field.Label>
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="feat/my-branch"
						autoFocus
					/>
				</Field.Root>
				<Text fontSize="xs" color="fg.muted">
					From: <code>{startPoint ?? "HEAD"}</code>
				</Text>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
						cursor: "pointer",
					}}
				>
					<input
						type="checkbox"
						checked={checkoutAfter}
						onChange={(e) => setCheckoutAfter(e.target.checked)}
					/>
					<Text fontSize="sm">Checkout after creating</Text>
				</label>
			</Stack>
		</RewriteDialogShell>
	);
}

function RenameBranchDialog({
	profileId,
	branch,
	onClose,
}: {
	profileId: string;
	branch: BranchInfo;
	onClose: () => void;
}) {
	const rename = useRenameBranch(profileId);
	const [newName, setNewName] = useState(branch.name);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		setError(null);
		const trimmed = newName.trim();
		if (!trimmed || trimmed === branch.name) return;
		try {
			await rename.mutateAsync({
				oldName: branch.name,
				newName: trimmed,
			});
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title={`Rename "${branch.name}"`}
			onClose={onClose}
			submitting={rename.isPending}
			submitDisabled={
				!newName.trim() ||
				newName.trim() === branch.name ||
				rename.isPending
			}
			submitLabel="Rename"
			onSubmit={handleSubmit}
			error={error}
		>
			<Field.Root>
				<Field.Label>New name</Field.Label>
				<Input
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
				/>
			</Field.Root>
		</RewriteDialogShell>
	);
}

function DeleteBranchDialog({
	profileId,
	branch,
	onClose,
}: {
	profileId: string;
	branch: BranchInfo;
	onClose: () => void;
}) {
	const remove = useDeleteBranch(profileId);
	const [force, setForce] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		setError(null);
		try {
			await remove.mutateAsync({ name: branch.name, force });
			onClose();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			// If git rejects because the branch is unmerged, hint at the
			// force option directly in the error.
			if (
				/not fully merged|unmerged/i.test(msg) &&
				!force
			) {
				setError(
					`${msg}\n\nTick "Force delete" to remove anyway.`,
				);
			} else {
				setError(msg);
			}
		}
	};

	return (
		<RewriteDialogShell
			title={`Delete "${branch.name}"?`}
			onClose={onClose}
			submitting={remove.isPending}
			submitDisabled={remove.isPending}
			submitLabel={force ? "Force delete" : "Delete"}
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="sm">
					Delete the branch <code>{branch.name}</code>?
					{branch.upstream && (
						<>
							{" "}It tracks <code>{branch.upstream}</code>.
						</>
					)}
				</Text>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
						cursor: "pointer",
					}}
				>
					<input
						type="checkbox"
						checked={force}
						onChange={(e) => setForce(e.target.checked)}
					/>
					<Text fontSize="sm" color={force ? "red.fg" : undefined}>
						Force delete (allow unmerged)
					</Text>
				</label>
				<Text fontSize="xs" color="fg.muted">
					{force
						? "Will use git branch -D — discards unmerged commits."
						: "Refuses if the branch has unmerged commits."}
				</Text>
			</Stack>
		</RewriteDialogShell>
	);
}

// ── Remote-branch dialogs ──

function DeleteRemoteBranchDialog({
	profileId,
	rb,
	onClose,
}: {
	profileId: string;
	rb: RemoteBranchInfo;
	onClose: () => void;
}) {
	const remove = useGitDeleteRemoteBranch(profileId);
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const armed = confirm.trim() === rb.branch;

	const handleSubmit = async () => {
		if (!armed) return;
		setError(null);
		try {
			await remove.mutateAsync({ remote: rb.remote, branch: rb.branch });
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title={`Delete "${rb.name}" from remote?`}
			onClose={onClose}
			submitting={remove.isPending}
			submitDisabled={!armed || remove.isPending}
			submitLabel="Delete on remote"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="sm">
					This will run <code>git push {rb.remote} --delete {rb.branch}</code>,
					removing the branch from <code>{rb.remote}</code>. Anyone else
					tracking this branch will lose it on their next fetch.
				</Text>
				<Field.Root>
					<Field.Label>
						Type the branch name <code>{rb.branch}</code> to confirm
					</Field.Label>
					<Input
						value={confirm}
						onChange={(e) => setConfirm(e.target.value)}
						placeholder={rb.branch}
					/>
				</Field.Root>
			</Stack>
		</RewriteDialogShell>
	);
}

function RenameRemoteBranchDialog({
	profileId,
	rb,
	onClose,
}: {
	profileId: string;
	rb: RemoteBranchInfo;
	onClose: () => void;
}) {
	const rename = useGitRenameRemoteBranch(profileId);
	const [newName, setNewName] = useState(rb.branch);
	const [error, setError] = useState<string | null>(null);

	const trimmed = newName.trim();
	const valid = trimmed && trimmed !== rb.branch;

	const handleSubmit = async () => {
		if (!valid) return;
		setError(null);
		try {
			await rename.mutateAsync({
				remote: rb.remote,
				oldBranch: rb.branch,
				newBranch: trimmed,
			});
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title={`Rename "${rb.name}" on remote`}
			onClose={onClose}
			submitting={rename.isPending}
			submitDisabled={!valid || rename.isPending}
			submitLabel="Rename on remote"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="sm">
					Git has no first-class rename for remote branches. We'll push the
					new name to <code>{rb.remote}</code>, then delete the old one.
					Both names exist briefly while this runs.
				</Text>
				<Field.Root>
					<Field.Label>New branch name on {rb.remote}</Field.Label>
					<Input
						value={newName}
						onChange={(e) => setNewName(e.target.value)}
					/>
				</Field.Root>
			</Stack>
		</RewriteDialogShell>
	);
}

function ConfirmRebaseDialog({
	profileId,
	targetRef,
	targetLabel,
	currentBranchName,
	onClose,
}: {
	profileId: string;
	targetRef: string;
	targetLabel: string;
	currentBranchName: string | null;
	onClose: () => void;
}) {
	const rebase = useGitRebaseOnto(profileId);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		setError(null);
		try {
			await rebase.mutateAsync({ target: targetRef });
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title={`Rebase ${currentBranchName ?? "current branch"} onto ${targetLabel}?`}
			onClose={onClose}
			submitting={rebase.isPending}
			submitDisabled={rebase.isPending || currentBranchName == null}
			submitLabel="Rebase"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="sm">
					Replays your <code>{currentBranchName ?? "?"}</code> commits on top
					of <code>{targetLabel}</code>. Conflicts pause the rebase — the
					In-Progress banner will show resolve / continue / abort.
				</Text>
				<Text fontSize="xs" color="fg.muted">
					Rewrites your branch's history. If you've already pushed{" "}
					<code>{currentBranchName ?? "this branch"}</code>, you'll need a
					force-push afterward.
				</Text>
			</Stack>
		</RewriteDialogShell>
	);
}

function ConfirmMergeDialog({
	profileId,
	targetRef,
	targetLabel,
	currentBranchName,
	onClose,
}: {
	profileId: string;
	targetRef: string;
	targetLabel: string;
	currentBranchName: string | null;
	onClose: () => void;
}) {
	const merge = useGitMergeRef(profileId);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		setError(null);
		try {
			await merge.mutateAsync({ target: targetRef });
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title={`Merge ${targetLabel} into ${currentBranchName ?? "current branch"}?`}
			onClose={onClose}
			submitting={merge.isPending}
			submitDisabled={merge.isPending || currentBranchName == null}
			submitLabel="Merge"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Text fontSize="sm">
					Merges <code>{targetLabel}</code> into{" "}
					<code>{currentBranchName ?? "?"}</code> with{" "}
					<code>--no-edit</code>. Conflicts pause the merge — the In-Progress
					banner will show resolve / continue / abort.
				</Text>
			</Stack>
		</RewriteDialogShell>
	);
}

// ── Remote ops toolbar (Fetch / Pull / Push / + New) ──

function RemoteOpsToolbar({
	profileId,
	currentBranch,
	onCreate,
}: {
	profileId: string;
	currentBranch: BranchInfo | null;
	onCreate: () => void;
}) {
	const fetch = useGitFetch(profileId);
	const pull = useGitPull(profileId);
	const push = useGitPushWithLease(profileId);

	const hasUpstream = !!currentBranch?.upstream;
	const ahead = currentBranch?.ahead ?? 0;
	const behind = currentBranch?.behind ?? 0;
	const [forceConfirmFor, setForceConfirmFor] = useState<string | null>(
		null,
	);

	const handle = useCallback(
		async <T,>(
			label: string,
			fn: () => Promise<T>,
		) => {
			try {
				await fn();
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (!showGitErrorToast(e)) {
					// Fallback: showGitErrorToast already showed a generic
					// toast for unstructured errors; nothing more to do.
					void label;
					void msg;
				}
			}
		},
		[],
	);

	return (
		<HStack gap="0">
			<ToolbarIcon
				label="Fetch all remotes"
				icon={<FiRefreshCw />}
				busy={fetch.isPending}
				onClick={(e) => {
					e.stopPropagation();
					handle("fetch", () => fetch.mutateAsync({ remote: null }));
				}}
			/>
			{hasUpstream && (
				<ToolbarIcon
					label={
						behind > 0
							? `Pull (rebase) — ${behind} behind`
							: "Pull (rebase)"
					}
					icon={<FiDownloadCloud />}
					badge={behind > 0 ? behind : undefined}
					busy={pull.isPending}
					onClick={(e) => {
						e.stopPropagation();
						handle("pull", () =>
							pull.mutateAsync({ mode: "rebase" }),
						);
					}}
				/>
			)}
			{hasUpstream && (
				<ToolbarIcon
					label={
						ahead > 0
							? `Push — ${ahead} ahead (force-with-lease on shift-click)`
							: "Push (force-with-lease on shift-click)"
					}
					icon={<FiUpload />}
					badge={ahead > 0 ? ahead : undefined}
					busy={push.isPending}
					onClick={(e) => {
						e.stopPropagation();
						if (e.shiftKey && currentBranch) {
							setForceConfirmFor(currentBranch.name);
							return;
						}
						handle("push", () =>
							push.mutateAsync({ forceRaw: false }),
						);
					}}
				/>
			)}
			<ToolbarIcon
				label="New branch from HEAD"
				icon={<FiPlus />}
				onClick={(e) => {
					e.stopPropagation();
					onCreate();
				}}
			/>

			{forceConfirmFor && (
				<ForcePushConfirmDialog
					branchName={forceConfirmFor}
					onClose={() => setForceConfirmFor(null)}
					onConfirm={async (raw) => {
						setForceConfirmFor(null);
						await handle("push", () =>
							push.mutateAsync({ forceRaw: raw }),
						);
					}}
				/>
			)}
		</HStack>
	);
}

function ToolbarIcon({
	label,
	icon,
	onClick,
	busy,
	badge,
}: {
	label: string;
	icon: React.ReactNode;
	onClick: (e: React.MouseEvent) => void;
	busy?: boolean;
	badge?: number;
}) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<HStack gap="0.5" position="relative">
					<IconButton
						aria-label={label}
						size="2xs"
						variant="ghost"
						onClick={onClick}
						disabled={busy}
					>
						{busy ? <Spinner size="xs" /> : icon}
					</IconButton>
					{badge !== undefined && badge > 0 && (
						<Text
							position="absolute"
							top="-1"
							right="-1"
							fontSize="2xs"
							color="orange.fg"
							fontWeight="semibold"
						>
							{badge}
						</Text>
					)}
				</HStack>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{label}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}

function ForcePushConfirmDialog({
	branchName,
	onClose,
	onConfirm,
}: {
	branchName: string;
	onClose: () => void;
	onConfirm: (raw: boolean) => void;
}) {
	const [typed, setTyped] = useState("");
	const [useRaw, setUseRaw] = useState(false);
	const matches = typed === branchName;

	return (
		<RewriteDialogShell
			title="Force push"
			onClose={onClose}
			submitting={false}
			submitDisabled={!matches}
			submitLabel={useRaw ? "Force push (raw)" : "Force-with-lease"}
			onSubmit={() => onConfirm(useRaw)}
		>
			<Stack gap="3">
				<Text fontSize="sm">
					Force-pushing rewrites the remote branch. Type the branch
					name to confirm:
				</Text>
				<Field.Root>
					<Field.Label>
						<code>{branchName}</code>
					</Field.Label>
					<Input
						value={typed}
						onChange={(e) => setTyped(e.target.value)}
						placeholder={branchName}
						autoFocus
					/>
				</Field.Root>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: "6px",
						cursor: "pointer",
					}}
				>
					<input
						type="checkbox"
						checked={useRaw}
						onChange={(e) => setUseRaw(e.target.checked)}
					/>
					<Text fontSize="sm" color={useRaw ? "red.fg" : undefined}>
						Use raw <code>--force</code> (skip lease check)
					</Text>
				</label>
				<Text fontSize="xs" color="fg.muted">
					{useRaw
						? "Will clobber any commits the remote has that you don't. Use only if the lease check is wrong."
						: "Refuses if the remote ref changed since your last fetch — protects against clobbering teammates' commits."}
				</Text>
			</Stack>
		</RewriteDialogShell>
	);
}

// Avoid unused-import warnings while we still don't have Button-only fallbacks.
const _unused = [Button, FiDownload];
void _unused;
