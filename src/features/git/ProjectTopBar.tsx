import { motion, useReducedMotion } from "motion/react";
import type { Dispatch } from "react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	PiGearSixFill,
	PiGitBranchFill,
	PiSidebarSimpleFill,
} from "react-icons/pi";
import { cn } from "@/lib/utils";
import GitDiffDialog from "@/features/git/GitDiffDialog";
import {
	type GitDiffAction,
	type GitDiffState,
	gitDiffReducer,
	initialState,
} from "@/features/git/gitDiffReducer";
import { useGitBranch } from "@/features/projects/hooks";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import { useSupportedTopbarAppIds } from "@/features/topbar/hooks";
import {
	controlRegistry,
	getSupportedControlIds,
} from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { isWindowsPlatform } from "@/shared/lib/platform";

const FILE_TREE_TOGGLE_ICON_TRANSITION = {
	duration: 0.12,
	ease: [0.2, 0, 0.2, 1],
} as const;
const EMPTY_CONTROL_OPTIONS: Record<string, unknown> = {};
const IS_WINDOWS_PLATFORM = isWindowsPlatform();

function GitBranchLabel({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<span className="flex select-none items-center gap-1">
			<PiGitBranchFill />
			<span>{branch}</span>
		</span>
	);
}

function GitDiffDialogWithBranch({
	cwd,
	isOpen,
	isActive,
	onClose,
	profileId,
	worktreePath,
	state,
	dispatch,
}: {
	cwd: string;
	isOpen: boolean;
	isActive: boolean;
	onClose: () => void;
	profileId: string;
	worktreePath: string;
	state: GitDiffState;
	dispatch: Dispatch<GitDiffAction>;
}) {
	const { data: branch } = useGitBranch(cwd, isOpen && isActive);
	return (
		<GitDiffDialog
			isOpen={isOpen}
			onClose={onClose}
			profileId={profileId}
			worktreePath={worktreePath}
			branchName={branch ?? undefined}
			state={state}
			dispatch={dispatch}
		/>
	);
}

interface ProjectTopBarProps {
	projectId: string;
	projectName: string;
	profile: Profile;
	isActive: boolean;
	isFileTreeOpen?: boolean;
	onToggleFileTree?: () => void;
}

export default function ProjectTopBar({
	projectId,
	projectName,
	profile,
	isActive,
	isFileTreeOpen = false,
	onToggleFileTree,
}: ProjectTopBarProps) {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const controlOptions = useTopBarStore((s) => s.controlOptions);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [gitDiffOpen, setGitDiffOpen] = useState(false);
	const [gitDiffState, dispatchGitDiff] = useReducer(
		gitDiffReducer,
		initialState,
	);
	const { data: supportedAppIds = [] } = useSupportedTopbarAppIds();
	const prefersReducedMotion = useReducedMotion() ?? false;
	const openGitDiffDialog = useCallback(() => {
		dispatchGitDiff({ type: "switchTab", tab: "changes" });
		setGitDiffOpen(true);
	}, []);
	const closeGitDiffDialog = useCallback(() => setGitDiffOpen(false), []);
	const openSettingsDialog = useCallback(() => setSettingsOpen(true), []);
	const closeSettingsDialog = useCallback(() => setSettingsOpen(false), []);

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "g") {
				e.preventDefault();
				openGitDiffDialog();
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "e") {
				e.preventDefault();
				onToggleFileTree?.();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isActive, onToggleFileTree, openGitDiffDialog]);
	const supportedControlIds = useMemo(
		() => getSupportedControlIds(supportedAppIds),
		[supportedAppIds],
	);
	const supportedControlIdSet = useMemo(
		() => new Set(supportedControlIds),
		[supportedControlIds],
	);
	const visibleActiveControls = useMemo(
		() => activeControls.filter((id) => supportedControlIdSet.has(id)),
		[activeControls, supportedControlIdSet],
	);
	const gitDiffControlOptions = useMemo(
		() => ({
			...(controlOptions["git-diff"] ?? EMPTY_CONTROL_OPTIONS),
			onOpen: openGitDiffDialog,
			statsPaused: gitDiffOpen,
		}),
		[controlOptions, gitDiffOpen, openGitDiffDialog],
	);

	const titleContent = (
		<div className="flex min-w-0 items-center gap-2">
			{onToggleFileTree && (
				<Tooltip>
					<TooltipTrigger
						render={(
							<Button
							aria-label={isFileTreeOpen ? "Close file tree" : "Open file tree"}
							aria-pressed={isFileTreeOpen}
							size="icon-sm"
							variant="ghost"
							className={cn(
								"p-0",
								isFileTreeOpen
									? "bg-muted text-foreground hover:bg-muted"
									: "text-muted-foreground",
								!prefersReducedMotion &&
									"transition-colors duration-200",
							)}
							onClick={onToggleFileTree}
						/>
						)}
					>
							<motion.span
								animate={{
									rotate: isFileTreeOpen ? 0 : 180,
									x: isFileTreeOpen ? 0 : -1,
								}}
								transition={
									prefersReducedMotion
										? { duration: 0 }
										: FILE_TREE_TOGGLE_ICON_TRANSITION
								}
								style={{ display: "inline-flex" }}
							>
								<PiSidebarSimpleFill />
							</motion.span>
					</TooltipTrigger>
					<TooltipContent>
						{isFileTreeOpen ? "Close file tree" : "Open file tree"} ⌘E
					</TooltipContent>
				</Tooltip>
			)}
			<Tooltip>
				<TooltipTrigger
					render={(
						<span className="cursor-default select-none font-semibold" />
					)}
				>
					{projectName}
				</TooltipTrigger>
				<TooltipContent>
					<span className="text-xs">{profile.worktree_path}</span>
				</TooltipContent>
			</Tooltip>
			<div className="text-muted-foreground">
				{profile.is_default ? (
					isActive ? (
						<GitBranchLabel cwd={profile.worktree_path} />
					) : null
				) : (
					<span className="flex select-none items-center gap-1">
						<PiGitBranchFill />
						<span>{profile.branch_name}</span>
					</span>
				)}
			</div>
		</div>
	);

	const controlsContent = (
		<div className="flex items-center gap-2">
			{visibleActiveControls.map((controlId) => {
				const def = controlRegistry.get(controlId);
				if (!def) return null;
				const Comp = def.component;
				return (
					<Comp
						key={controlId}
						profile={profile}
						isActive={isActive}
						options={
							controlId === "git-diff"
								? gitDiffControlOptions
								: (controlOptions[controlId] ?? EMPTY_CONTROL_OPTIONS)
						}
					/>
				);
			})}
			<Tooltip>
				<TooltipTrigger
					render={(
						<Button
						aria-label={m.projectSettings()}
						size="icon-sm"
						variant="secondary"
						onClick={openSettingsDialog}
					/>
					)}
				>
					<PiGearSixFill />
				</TooltipTrigger>
				<TooltipContent>{m.projectSettings()}</TooltipContent>
			</Tooltip>
		</div>
	);

	return (
		<>
			<div
				data-tauri-drag-region
				className={cn(
					"flex min-h-[44px] items-end justify-between px-4 pt-1 pb-1.5",
					IS_WINDOWS_PLATFORM ? "pr-[118px]" : "pr-5",
				)}
			>
				{titleContent}
				{controlsContent}
			</div>

			<ProjectSettingsDialog
				isOpen={settingsOpen}
				onClose={closeSettingsDialog}
				projectId={projectId}
			/>

			{profile.is_default ? (
				<GitDiffDialogWithBranch
					cwd={profile.worktree_path}
					isOpen={gitDiffOpen}
					isActive={isActive}
					onClose={closeGitDiffDialog}
					profileId={profile.id}
					worktreePath={profile.worktree_path}
					state={gitDiffState}
					dispatch={dispatchGitDiff}
				/>
			) : (
				<GitDiffDialog
					isOpen={gitDiffOpen}
					onClose={closeGitDiffDialog}
					profileId={profile.id}
					worktreePath={profile.worktree_path}
					branchName={profile.branch_name}
					state={gitDiffState}
					dispatch={dispatchGitDiff}
				/>
			)}
		</>
	);
}
