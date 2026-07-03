import { GearSixIcon, GitBranchIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
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
import { cn } from "@/lib/utils";
import GitDiffDialog from "@/features/git/GitDiffDialog";
import SwitchBranchDialog from "@/features/git/SwitchBranchDialog";
import {
	type GitDiffAction,
	type GitDiffState,
	gitDiffReducer,
	initialState,
} from "@/features/git/gitDiffReducer";
import {
	useGitBranch,
	useRevealPathInFileManager,
} from "@/features/projects/hooks";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import SidebarModeSwitch, {
	type ProfileSidebarMode,
} from "@/features/projects/SidebarModeSwitch";
import { useSupportedTopbarAppIds } from "@/features/topbar/hooks";
import {
	controlRegistry,
	getSupportedControlIds,
} from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import { useAppSidebarStore } from "@/layout/sidebarStore";
import * as m from "@/paraglide/messages.js";
import { isMacPlatform, isWindowsPlatform } from "@/shared/lib/platform";

const EMPTY_CONTROL_OPTIONS: Record<string, unknown> = {};
const IS_WINDOWS_PLATFORM = isWindowsPlatform();
const IS_MAC_PLATFORM = isMacPlatform();

function GitBranchLabel({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<span className="flex select-none items-center gap-1">
			<GitBranchIcon className="shrink-0" />
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
	sidebarMode?: ProfileSidebarMode;
	onSidebarModeChange?: (mode: ProfileSidebarMode) => void;
}

export default function ProjectTopBar({
	projectId,
	projectName,
	profile,
	isActive,
	isFileTreeOpen = false,
	onToggleFileTree,
	sidebarMode,
	onSidebarModeChange,
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
	const isAppSidebarCollapsed = useAppSidebarStore((s) => s.isCollapsed);
	const toggleAppSidebarCollapsed = useAppSidebarStore(
		(s) => s.toggleCollapsed,
	);
	const openGitDiffDialog = useCallback(() => {
		dispatchGitDiff({ type: "switchTab", tab: "changes" });
		setGitDiffOpen(true);
	}, []);
	const closeGitDiffDialog = useCallback(() => setGitDiffOpen(false), []);
	const openSettingsDialog = useCallback(() => setSettingsOpen(true), []);
	const closeSettingsDialog = useCallback(() => setSettingsOpen(false), []);
	const revealInFileManager = useRevealPathInFileManager(profile.id);
	const handleRevealWorktree = useCallback(() => {
		revealInFileManager.mutate({ path: null });
	}, [revealInFileManager]);
	const [switchBranchOpen, setSwitchBranchOpen] = useState(false);
	const openSwitchBranchDialog = useCallback(
		() => setSwitchBranchOpen(true),
		[],
	);
	const closeSwitchBranchDialog = useCallback(
		() => setSwitchBranchOpen(false),
		[],
	);

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

	const leftContent = (
		<div className="flex items-center gap-2">
			{isAppSidebarCollapsed && (
				<Tooltip>
					<TooltipTrigger
						render={(
							<Button
								aria-label={m.expandSidebar()}
								aria-expanded={false}
								size="icon"
								variant="ghost"
								className="text-muted-foreground"
								onClick={toggleAppSidebarCollapsed}
							/>
						)}
					>
						<SidebarSimpleIcon />
					</TooltipTrigger>
					<TooltipContent>{m.expandSidebar()}</TooltipContent>
				</Tooltip>
			)}
			{sidebarMode && onSidebarModeChange && (
				<SidebarModeSwitch
					profileId={profile.id}
					isActive={isActive}
					isOpen={isFileTreeOpen}
					mode={sidebarMode}
					onModeChange={onSidebarModeChange}
				/>
			)}
		</div>
	);

	const titleContent = (
		<div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex min-w-0 items-center justify-center gap-2 px-32">
			<Tooltip>
				<TooltipTrigger
					render={(
						<button
							type="button"
							className="pointer-events-auto cursor-pointer select-none truncate font-semibold"
							onClick={handleRevealWorktree}
						/>
					)}
				>
					{projectName}
				</TooltipTrigger>
				<TooltipContent>
					<span className="text-xs">{profile.worktree_path}</span>
				</TooltipContent>
			</Tooltip>
			<button
				type="button"
				aria-label={m.switchBranchTitle()}
				className="pointer-events-auto min-w-0 cursor-pointer text-muted-foreground hover:text-foreground"
				onClick={openSwitchBranchDialog}
			>
				{profile.is_default ? (
					isActive ? (
						<GitBranchLabel cwd={profile.worktree_path} />
					) : null
				) : (
					<span className="flex select-none items-center gap-1">
						<GitBranchIcon className="shrink-0" />
						<span className="truncate">{profile.branch_name}</span>
					</span>
				)}
			</button>
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
						options={controlOptions[controlId] ?? EMPTY_CONTROL_OPTIONS}
					/>
				);
			})}
			<Tooltip>
				<TooltipTrigger
					render={(
						<Button
						aria-label={m.projectSettings()}
						size="icon"
						variant="secondary"
						onClick={openSettingsDialog}
					/>
					)}
				>
					<GearSixIcon />
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
					"relative flex min-h-[44px] items-end justify-between px-4 pt-1 pb-1.5",
					IS_WINDOWS_PLATFORM ? "pr-[118px]" : "pr-5",
					// Clear the macOS traffic lights when the app sidebar is hidden.
					IS_MAC_PLATFORM && isAppSidebarCollapsed && "pl-[84px]",
				)}
			>
				{leftContent}
				{titleContent}
				{controlsContent}
			</div>

			<ProjectSettingsDialog
				isOpen={settingsOpen}
				onClose={closeSettingsDialog}
				projectId={projectId}
			/>

			<SwitchBranchDialog
				isOpen={switchBranchOpen}
				onClose={closeSwitchBranchDialog}
				profileId={profile.id}
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
