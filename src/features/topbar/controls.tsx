import { Button, IconButton, Portal, Text, Tooltip } from "@chakra-ui/react";
import {
	SiCursor,
	SiGhostty,
	SiGit,
	SiGithub,
	SiIterm2,
	SiSublimetext,
	SiVscodium,
	SiWarp,
	SiWindsurf,
	SiZedindustries,
} from "@icons-pack/react-simple-icons";
import { Command } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import { FiFolder, FiTerminal } from "react-icons/fi";
import { useGitDiffStats } from "@/features/git/hooks";
import * as m from "@/paraglide/messages.js";
import { useOpenTopbarApp } from "./hooks";
import type { ControlProps, LaunchAppControlId } from "./types";

function AppButton({
	label,
	appId,
	icon: Icon,
	profile,
}: ControlProps & {
	label: string;
	appId: LaunchAppControlId;
	icon: ComponentType<{ size?: number | string }>;
}) {
	const openApp = useOpenTopbarApp();

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<IconButton
					aria-label={label}
					size="xs"
					variant="subtle"
					onClick={() =>
						openApp.mutate({
							appId,
							path: profile.worktree_path,
						})
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
		<AppButton
			{...props}
			label={m.topbarGithubDesktop()}
			appId="github-desktop"
			icon={SiGithub}
		/>
	);
}

export function VscodeControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarVscode()}
			appId="vscode"
			icon={SiVscodium}
		/>
	);
}

export function WindsurfControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarWindsurf()}
			appId="windsurf"
			icon={SiWindsurf}
		/>
	);
}

export function CursorControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarCursor()}
			appId="cursor"
			icon={SiCursor}
		/>
	);
}

export function ZedControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarZed()}
			appId="zed"
			icon={SiZedindustries}
		/>
	);
}

export function SublimeTextControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarSublimeText()}
			appId="sublime-text"
			icon={SiSublimetext}
		/>
	);
}

export function GhosttyControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarGhostty()}
			appId="ghostty"
			icon={SiGhostty}
		/>
	);
}

export function Iterm2Control(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarIterm2()}
			appId="iterm2"
			icon={SiIterm2}
		/>
	);
}

export function KittyControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarKitty()}
			appId="kitty"
			icon={FiTerminal}
		/>
	);
}

export function WarpControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarWarp()}
			appId="warp"
			icon={SiWarp}
		/>
	);
}

export function GitDiffControl({ profile, isActive, options }: ControlProps) {
	const onOpen = options.onOpen as (() => void) | undefined;
	const stats = useGitDiffStats(profile.id, isActive);

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<Button
					aria-label={m.topbarGitDiff()}
					size="xs"
					variant="subtle"
					onClick={() => onOpen?.()}
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
	);
}

export function RevealInFinderControl({ profile }: ControlProps) {
	const handleReveal = async () => {
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
					<FiFolder />
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
