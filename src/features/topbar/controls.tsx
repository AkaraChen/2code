import {
	Box,
	Button,
	CloseButton,
	Dialog,
	IconButton,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import {
	SiCursor,
	SiGit,
	SiGithub,
	SiVscodium,
	SiWindsurf,
} from "@icons-pack/react-simple-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Command, open } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import { Suspense } from "react";
import {
	RiArrowRightUpLine,
	RiFolderLine,
	RiGitMergeLine,
	RiGitPullRequestLine,
} from "react-icons/ri";
import GitDiffDialog from "@/features/git/GitDiffDialog";
import { useGitDiffStats, useGithubPrStatus } from "@/features/git/hooks";
import { useGitBranch } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";
import { queryKeys } from "@/shared/lib/queryKeys";
import { toaster } from "@/shared/providers/toaster-instance";
import type { ControlProps } from "./types";

function EditorButton({
	label,
	cmd,
	icon: Icon,
	profile,
}: ControlProps & {
	label: string;
	cmd: string;
	icon: ComponentType<{ size?: number }>;
}) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<IconButton
					aria-label={label}
					size="xs"
					variant="subtle"
					onClick={() =>
						Command.create(cmd, [profile.worktree_path]).execute()
					}
				>
					<Icon size={14} />
				</IconButton>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{label}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}

export function GithubDesktopControl(props: ControlProps) {
	return (
		<EditorButton
			{...props}
			label={m.topbarGithubDesktop()}
			cmd="github"
			icon={SiGithub}
		/>
	);
}

export function VscodeControl(props: ControlProps) {
	return (
		<EditorButton
			{...props}
			label={m.topbarVscode()}
			cmd="code"
			icon={SiVscodium}
		/>
	);
}

export function WindsurfControl(props: ControlProps) {
	return (
		<EditorButton
			{...props}
			label={m.topbarWindsurf()}
			cmd="windsurf"
			icon={SiWindsurf}
		/>
	);
}

export function CursorControl(props: ControlProps) {
	return (
		<EditorButton
			{...props}
			label={m.topbarCursor()}
			cmd="cursor"
			icon={SiCursor}
		/>
	);
}

function GithubPrCreateDialog({
	isOpen,
	onClose,
	branchName,
	statusSummary,
	worktreeClean,
	onConfirm,
}: {
	isOpen: boolean;
	onClose: () => void;
	branchName: string;
	statusSummary: string;
	worktreeClean: boolean;
	onConfirm: () => void;
}) {
	return (
		<Dialog.Root
			lazyMount
			open={isOpen}
			onOpenChange={(e) => {
				if (!e.open) onClose();
			}}
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>
								{m.topbarCreatePrConfirmTitle()}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<Text mb="2">{m.topbarCreatePrConfirmDesc()}</Text>
							<Text fontSize="sm" color="fg.muted" mb="2">
								{m.topbarCreatePrBranch({ branch: branchName })}
							</Text>
							<Text fontSize="sm" mb="1">
								{worktreeClean
									? m.topbarPrWorktreeClean()
									: m.topbarPrWorktreeDirty()}
							</Text>
							<Text fontSize="xs" color="fg.muted" mb="1">
								{m.topbarCreatePrCurrentStatus()}
							</Text>
							<Box
								as="pre"
								fontSize="xs"
								fontFamily="mono"
								p="2"
								bg="bg.muted"
								rounded="md"
								maxH="28"
								overflow="auto"
								whiteSpace="pre-wrap"
							>
								{statusSummary || branchName}
							</Box>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button variant="outline">{m.cancel()}</Button>
							</Dialog.ActionTrigger>
							<Button onClick={onConfirm}>
								{m.topbarCreatePr()}
							</Button>
						</Dialog.Footer>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}

export function GithubPrControl({ profile }: ControlProps) {
	const dialog = useDialogState();
	const queryClient = useQueryClient();
	const { data: prStatus } = useGithubPrStatus(profile.worktree_path);

	if (!prStatus?.is_github_host || prStatus.is_main_branch) {
		return null;
	}

	const refreshStatus = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.git.githubPrStatus(profile.worktree_path),
		});
	};

	const openExternal = async (url: string) => {
		try {
			await open(url);
		} catch (error) {
			toaster.error({
				title: m.somethingWentWrong(),
				description:
					error instanceof Error ? error.message : String(error),
			});
		}
	};

	if (prStatus.pr) {
		const pr = prStatus.pr;
		const isMerged = pr.state === "Merged";
		const label = isMerged ? m.topbarMergedPr() : m.topbarOpenPr();
		return (
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Button
						size="xs"
						variant="subtle"
						aria-label={label}
						aria-disabled={isMerged}
						opacity={isMerged ? 0.55 : 1}
						onClick={() => {
							void openExternal(pr.url);
						}}
					>
						<Box position="relative" display="inline-flex">
							{isMerged ? (
								<RiGitMergeLine size={14} />
							) : (
								<RiGitPullRequestLine size={14} />
							)}
							<Box
								position="absolute"
								top="-3px"
								right="-4px"
								color="fg.muted"
							>
								<RiArrowRightUpLine size={10} />
							</Box>
						</Box>
						<Text as="span">#{pr.number}</Text>
					</Button>
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>{label}</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
		);
	}

	return (
		<>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Button
						aria-label={m.topbarCreatePr()}
						size="xs"
						variant="subtle"
						onClick={dialog.onOpen}
					>
						<RiGitPullRequestLine size={14} />
						<Text as="span">{m.topbarCreatePr()}</Text>
					</Button>
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>{m.topbarCreatePr()}</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>

			<GithubPrCreateDialog
				isOpen={dialog.isOpen}
				onClose={dialog.onClose}
				branchName={prStatus.branch}
				statusSummary={prStatus.status_summary}
				worktreeClean={prStatus.worktree_clean}
				onConfirm={() => {
					if (!prStatus.create_url) return;
					void openExternal(prStatus.create_url).then(() => {
						dialog.onClose();
						refreshStatus();
					});
				}}
			/>
		</>
	);
}

function GitDiffBranchDialog({
	cwd,
	isOpen,
	onClose,
	profileId,
}: {
	cwd: string;
	isOpen: boolean;
	onClose: () => void;
	profileId: string;
}) {
	const { data: branch } = useGitBranch(cwd);
	return (
		<GitDiffDialog
			isOpen={isOpen}
			onClose={onClose}
			profileId={profileId}
			branchName={branch ?? undefined}
		/>
	);
}

export function GitDiffControl({ profile }: ControlProps) {
	const dialog = useDialogState();
	const stats = useGitDiffStats(profile.id);

	return (
		<>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Button
						aria-label={m.topbarGitDiff()}
						size="xs"
						variant="subtle"
						onClick={dialog.onOpen}
					>
						<SiGit size={14} />
						{stats && (
							<>
								<Text as="span" color="green.400" fontSize="xs">
									+{stats.additions}
								</Text>
								<Text as="span" color="red.400" fontSize="xs">
									-{stats.deletions}
								</Text>
							</>
						)}
					</Button>
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>{m.topbarGitDiff()}</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
			{profile.is_default ? (
				<Suspense>
					<GitDiffBranchDialog
						cwd={profile.worktree_path}
						isOpen={dialog.isOpen}
						onClose={dialog.onClose}
						profileId={profile.id}
					/>
				</Suspense>
			) : (
				<GitDiffDialog
					isOpen={dialog.isOpen}
					onClose={dialog.onClose}
					profileId={profile.id}
					branchName={profile.branch_name}
				/>
			)}
		</>
	);
}

export function RevealInFinderControl({ profile }: ControlProps) {
	const handleReveal = async () => {
		// macOS: open -R reveals the path in Finder
		// Windows: explorer opens the folder
		const isMac = navigator.platform.toUpperCase().includes("MAC");
		const cmd = isMac ? "open" : "explorer";
		const args = isMac
			? ["-R", profile.worktree_path]
			: [profile.worktree_path];
		await Command.create(cmd, args).execute();
	};

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<IconButton
					aria-label={m.revealInFinder()}
					size="xs"
					variant="subtle"
					onClick={handleReveal}
				>
					<RiFolderLine />
				</IconButton>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{m.revealInFinder()}</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}
