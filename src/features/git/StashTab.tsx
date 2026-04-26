// Phase 4 task #43: stash management.
//
// List of stashes (newest first) + per-row Pop / Apply / Drop actions
// + a "Stash changes…" button that opens a small dialog with message +
// include-untracked toggle.

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
import { Suspense, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { FiPlus, FiTrash2 } from "react-icons/fi";

import RewriteDialogShell from "./RewriteDialogShell";
import { showGitErrorToast } from "./gitError";
import {
	useGitStashes,
	useStashApply,
	useStashDrop,
	useStashPop,
	useStashPush,
} from "@/features/git/hooks";
import type { StashEntry } from "@/features/git/changesTabBindings";

interface StashTabProps {
	profileId: string;
}

export default function StashTab({ profileId }: StashTabProps) {
	return (
		<ErrorBoundary
			resetKeys={[profileId]}
			fallbackRender={({ error, resetErrorBoundary }) => (
				<Box p="3" fontSize="xs" color="fg.muted">
					<Box mb="1">Couldn't load stashes</Box>
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
				<StashTabInner profileId={profileId} />
			</Suspense>
		</ErrorBoundary>
	);
}

function StashTabInner({ profileId }: { profileId: string }) {
	const { data: stashes } = useGitStashes(profileId);
	const [pushOpen, setPushOpen] = useState(false);

	return (
		<Stack gap="2" pb="2">
			<HStack
				gap="2"
				px="1"
				py="1"
				color="fg.muted"
			>
				<Text
					fontSize="xs"
					fontWeight="semibold"
					textTransform="uppercase"
					flex="1"
				>
					Stashes ({stashes?.length ?? 0})
				</Text>
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<IconButton
							aria-label="Stash changes"
							size="2xs"
							variant="ghost"
							onClick={() => setPushOpen(true)}
						>
							<FiPlus />
						</IconButton>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>Stash changes…</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>
			</HStack>

			{(stashes?.length ?? 0) === 0 ? (
				<Box p="3" fontSize="sm" color="fg.muted" textAlign="center">
					No stashes
				</Box>
			) : (
				<Stack gap="0">
					{stashes?.map((s) => (
						<StashRow key={s.ref_name} profileId={profileId} stash={s} />
					))}
				</Stack>
			)}

			{pushOpen && (
				<StashPushDialog
					profileId={profileId}
					onClose={() => setPushOpen(false)}
				/>
			)}
		</Stack>
	);
}

function StashRow({
	profileId,
	stash,
}: {
	profileId: string;
	stash: StashEntry;
}) {
	const pop = useStashPop(profileId);
	const apply = useStashApply(profileId);
	const drop = useStashDrop(profileId);
	const [confirmDrop, setConfirmDrop] = useState(false);

	const handle = async (op: () => Promise<unknown>) => {
		try {
			await op();
		} catch (e) {
			showGitErrorToast(e);
		}
	};

	return (
		<Flex
			align="center"
			gap="2"
			px="1.5"
			py="1"
			borderRadius="sm"
			_hover={{ bg: "bg.subtle" }}
		>
			<Box flex="1" minW="0">
				<Text fontSize="sm" truncate title={stash.message}>
					{stash.message || stash.ref_name}
				</Text>
				<Text fontSize="2xs" color="fg.muted" truncate>
					{stash.ref_name} · {formatDate(stash.date)}
				</Text>
			</Box>
			<HStack gap="0">
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<Button
							size="2xs"
							variant="ghost"
							onClick={() =>
								handle(() => pop.mutateAsync({ refName: stash.ref_name }))
							}
							disabled={pop.isPending}
						>
							Pop
						</Button>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>
								Apply + drop
							</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<Button
							size="2xs"
							variant="ghost"
							onClick={() =>
								handle(() =>
									apply.mutateAsync({ refName: stash.ref_name }),
								)
							}
							disabled={apply.isPending}
						>
							Apply
						</Button>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>Apply (keep stash)</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<IconButton
							aria-label="Drop"
							size="2xs"
							variant="ghost"
							colorPalette="red"
							onClick={() => setConfirmDrop(true)}
							disabled={drop.isPending}
						>
							<FiTrash2 />
						</IconButton>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>Drop</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>
			</HStack>

			{confirmDrop && (
				<RewriteDialogShell
					title={`Drop "${stash.message || stash.ref_name}"?`}
					onClose={() => setConfirmDrop(false)}
					submitting={drop.isPending}
					submitDisabled={drop.isPending}
					submitLabel="Drop"
					onSubmit={async () => {
						setConfirmDrop(false);
						await handle(() =>
							drop.mutateAsync({ refName: stash.ref_name }),
						);
					}}
				>
					<Text fontSize="sm">
						This permanently removes the stash. Use Apply or Pop
						first if you want the changes back.
					</Text>
				</RewriteDialogShell>
			)}
		</Flex>
	);
}

function StashPushDialog({
	profileId,
	onClose,
}: {
	profileId: string;
	onClose: () => void;
}) {
	const push = useStashPush(profileId);
	const [message, setMessage] = useState("");
	const [includeUntracked, setIncludeUntracked] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async () => {
		setError(null);
		try {
			const did = await push.mutateAsync({
				message: message.trim() || null,
				includeUntracked,
			});
			if (!did) {
				setError("No local changes to stash.");
				return;
			}
			onClose();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	return (
		<RewriteDialogShell
			title="Stash changes"
			onClose={onClose}
			submitting={push.isPending}
			submitDisabled={push.isPending}
			submitLabel="Stash"
			onSubmit={handleSubmit}
			error={error}
		>
			<Stack gap="3">
				<Field.Root>
					<Field.Label>Message (optional)</Field.Label>
					<Input
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder="WIP refactoring auth"
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
						checked={includeUntracked}
						onChange={(e) => setIncludeUntracked(e.target.checked)}
					/>
					<Text fontSize="sm">Include untracked files</Text>
				</label>
			</Stack>
		</RewriteDialogShell>
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
	return d.toISOString().slice(0, 10);
}
