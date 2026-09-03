import {
	CodeIcon,
	GithubLogoIcon,
	GitPullRequestIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import { useMemo } from "react";
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
import { launchAppLabels } from "./appLabels";
import { useOpenTopbarApp, useSupportedTopbarAppIds } from "./hooks";
import { useTopBarStore } from "./store";
import {
	type ControlProps,
	editorAppIds,
	type LaunchAppId,
	terminalAppIds,
} from "./types";

function AppButton({
	label,
	appId,
	icon: Icon,
	profile,
}: ControlProps & {
	label: string;
	appId: LaunchAppId;
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

function useConfiguredApp(
	preferredApp: LaunchAppId,
	categoryAppIds: readonly LaunchAppId[],
) {
	const { data: supportedAppIds = [] } = useSupportedTopbarAppIds();
	return useMemo(() => {
		const supported = new Set(supportedAppIds);
		if (supported.has(preferredApp)) return preferredApp;
		return categoryAppIds.find((id) => supported.has(id)) ?? null;
	}, [categoryAppIds, preferredApp, supportedAppIds]);
}

export function GithubDesktopControl(props: ControlProps) {
	return (
		<AppButton
			{...props}
			label={m.topbarGithubDesktop()}
			appId="github-desktop"
			icon={GithubLogoIcon}
		/>
	);
}

export function EditorControl(props: ControlProps) {
	const editorApp = useTopBarStore((s) => s.editorApp);
	const appId = useConfiguredApp(editorApp, editorAppIds);
	if (!appId) return null;

	return (
		<AppButton
			{...props}
			label={`${m.topbarEditor()} · ${launchAppLabels[appId]()}`}
			appId={appId}
			icon={CodeIcon}
		/>
	);
}

export function TerminalControl(props: ControlProps) {
	const terminalApp = useTopBarStore((s) => s.terminalApp);
	const appId = useConfiguredApp(terminalApp, terminalAppIds);
	if (!appId) return null;

	return (
		<AppButton
			{...props}
			label={`${m.topbarTerminal()} · ${launchAppLabels[appId]()}`}
			appId={appId}
			icon={TerminalWindowIcon}
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
				<GitPullRequestIcon size={16} />
				<span className="text-xs">{label}</span>
			</TooltipTrigger>
			<TooltipContent>{tooltip}</TooltipContent>
		</Tooltip>
	);
}
