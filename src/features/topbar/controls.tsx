import { IconButton, Portal, Tooltip } from "@chakra-ui/react";
import {
	SiCursor,
	SiGit,
	SiGithub,
	SiVscodium,
	SiWindsurf,
} from "@icons-pack/react-simple-icons";
import { Command } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import { Suspense } from "react";
import GitDiffDialog from "@/features/git/GitDiffDialog";
import { useGitBranch } from "@/features/projects/hooks";
import * as m from "@/paraglide/messages.js";
import { useDialogState } from "@/shared/hooks/useDialogState";
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

	return (
		<>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<IconButton
						aria-label={m.topbarGitDiff()}
						size="xs"
						variant="subtle"
						onClick={dialog.onOpen}
					>
						<SiGit size={14} />
					</IconButton>
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
