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
import { open } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import { PiGitPullRequestFill, PiTerminalWindowFill } from "react-icons/pi";
import { VscVscode } from "react-icons/vsc";
import { useGitPullRequestStatus } from "@/features/git/hooks";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useGitBranch } from "@/features/projects/hooks";
import type { GitPullRequestStatus } from "@/generated";
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
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={label}
						size="icon-sm"
						variant="secondary"
						onClick={() =>
							openApp.mutate({
								appId,
								path: profile.worktree_path,
							})
						}
					/>
				}
			>
				<Icon size={16} />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
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
			icon={VscVscode}
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
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-label={m.topbarPrStatus()}
						size="xs"
						variant="secondary"
						onClick={handleOpen}
					/>
				}
			>
				<PiGitPullRequestFill size={16} />
				<span className="text-xs">{label}</span>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
