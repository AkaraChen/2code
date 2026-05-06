import { Button, IconButton, Portal, Text, Tooltip } from "@chakra-ui/react";
import {
	SiCursor,
	SiGhostty,
	SiGithub,
	SiIterm2,
	SiSublimetext,
	SiWarp,
	SiWindsurf,
	SiZedindustries,
} from "@icons-pack/react-simple-icons";
import { Command, open } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import {
	PiFolderOpenFill,
	PiGitDiffFill,
	PiGitPullRequestFill,
	PiTerminalWindowFill,
} from "react-icons/pi";
import {
	useGitDiffStats,
	useGitPullRequestStatus,
} from "@/features/git/hooks";
import { useGitBranch } from "@/features/projects/hooks";
import type { GitPullRequestStatus } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useOpenTopbarApp } from "./hooks";
import type { ControlProps, LaunchAppControlId } from "./types";

export function VscodeIcon({ size = 24 }: { size?: number | string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d="M16.89 1.2 7.8 9.18 3.28 5.83a1 1 0 0 0-1.28.08L.25 7.35a1 1 0 0 0 0 1.48L3.9 12 .25 15.17a1 1 0 0 0 0 1.48l1.75 1.44a1 1 0 0 0 1.28.08L7.8 14.82l9.09 7.98a1.5 1.5 0 0 0 1.7.33l4.97-2.39A1.5 1.5 0 0 0 24 19.37V4.63a1.5 1.5 0 0 0-.85-1.35l-4.56-2.39a1.5 1.5 0 0 0-1.7.31zM18.1 6.17v11.66L10.6 12l7.5-5.83z" />
		</svg>
	);
}

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
			icon={VscodeIcon}
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
			icon={PiTerminalWindowFill}
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
					<PiGitDiffFill size={14} />
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

function getPullRequestStateMeta(pr: GitPullRequestStatus) {
	const state = pr.state.toUpperCase();

	if (state === "OPEN" && pr.is_draft) {
		return { label: m.topbarPrDraft() };
	}

	if (state === "OPEN") {
		return { label: m.topbarPrOpen() };
	}

	if (state === "MERGED") {
		return { label: m.topbarPrMerged() };
	}

	if (state === "CLOSED") {
		return { label: m.topbarPrClosed() };
	}

	return { label: pr.state || "PR" };
}

export function GitPullRequestStatusControl({
	profile,
	isActive,
}: ControlProps) {
	const { data: branch } = useGitBranch(profile.worktree_path, isActive);
	const { data: pr } = useGitPullRequestStatus(
		profile.id,
		branch,
		isActive,
	);
	if (!pr) return null;

	const stateMeta = getPullRequestStateMeta(pr);
	const label = `#${pr.number} ${stateMeta.label}`;
	const tooltip = m.topbarPrTooltip({
		number: pr.number,
		title: pr.title,
		state: stateMeta.label,
	});

	const handleOpen = () => {
		void open(pr.url);
	};

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<Button
					aria-label={m.topbarPrStatus()}
					size="xs"
					variant="subtle"
					onClick={handleOpen}
				>
					<PiGitPullRequestFill size={14} />
					<Text as="span" fontSize="xs">
						{label}
					</Text>
				</Button>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content>{tooltip}</Tooltip.Content>
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
					<PiFolderOpenFill />
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
