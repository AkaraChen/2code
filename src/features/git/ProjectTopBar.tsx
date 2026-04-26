import {
	Box,
	Button,
	Flex,
	HStack,
	IconButton,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { motion, useReducedMotion } from "motion/react";
import { Suspense, useEffect, useState } from "react";
import { FiGitBranch, FiSettings, FiSidebar } from "react-icons/fi";
import { useGitDiffStats, useIsGitRepo } from "@/features/git/hooks";
import { useGitPanelStore } from "@/features/git/gitPanelStore";
import { useGitStateSubscription } from "@/features/git/useGitStateSubscription";
import { useGitBranch } from "@/features/projects/hooks";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import {
	controlRegistry,
	getSupportedControlIds,
} from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";

const FILE_TREE_TOGGLE_ICON_TRANSITION = {
	type: "spring",
	stiffness: 360,
	damping: 28,
	mass: 0.55,
} as const;

interface BranchAndChangesButtonProps {
	branchName: string;
	profileId: string;
	isActive: boolean;
	onOpen: () => void;
}

function BranchAndChangesButton({
	branchName,
	profileId,
	isActive,
	onOpen,
}: BranchAndChangesButtonProps) {
	const stats = useGitDiffStats(profileId, isActive);

	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>
				<Button
					aria-label={m.topbarBranchAndChanges()}
					size="xs"
					variant="ghost"
					gap="1.5"
					color="fg.muted"
					onClick={onOpen}
				>
					<FiGitBranch />
					<Text as="span">{branchName}</Text>
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

function DefaultProfileBranchAndChanges({
	cwd,
	profileId,
	isActive,
	onOpen,
}: {
	cwd: string;
	profileId: string;
	isActive: boolean;
	onOpen: () => void;
}) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<BranchAndChangesButton
			branchName={branch}
			profileId={profileId}
			isActive={isActive}
			onOpen={onOpen}
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
	const togglePanel = useGitPanelStore((s) => s.togglePanel);
	const prefersReducedMotion = useReducedMotion() ?? false;
	const isRepo = useIsGitRepo(profile.id);

	// Event-driven invalidation of git queries; replaces the 1s polling
	// that used to live inside each useGit* hook. Skip for non-repo folders
	// (start_git_watcher is also defensive but the round-trip is wasted).
	useGitStateSubscription(isActive && isRepo ? profile.id : undefined);

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "g") {
				e.preventDefault();
				togglePanel(profile.id);
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "e") {
				e.preventDefault();
				onToggleFileTree?.();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isActive, onToggleFileTree, profile.id, togglePanel]);
	const supportedControlIdSet = new Set(getSupportedControlIds());
	const visibleActiveControls = activeControls.filter((id) =>
		supportedControlIdSet.has(id),
	);

	return (
		<>
			<Flex
				data-tauri-drag-region
				align="flex-end"
				justify="space-between"
				pl="4"
				pr="5"
				pb="1.5"
				pt="3"
			>
				<HStack gap="2">
					{onToggleFileTree && (
						<Tooltip.Root>
							<Tooltip.Trigger asChild>
								<IconButton
									aria-label={isFileTreeOpen ? "Close file tree" : "Open file tree"}
									aria-pressed={isFileTreeOpen}
									size="xs"
									variant="ghost"
									p="0"
									color={isFileTreeOpen ? "fg" : "fg.muted"}
									bg={isFileTreeOpen ? "bg.subtle" : "transparent"}
									_hover={{
										bg: isFileTreeOpen ? "bg.muted" : "bg.subtle",
									}}
									transition={
										prefersReducedMotion
											? undefined
											: "background-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1)"
									}
									onClick={onToggleFileTree}
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
										<FiSidebar />
									</motion.span>
								</IconButton>
							</Tooltip.Trigger>
							<Portal>
								<Tooltip.Positioner>
									<Tooltip.Content>
										{isFileTreeOpen ? "Close file tree" : "Open file tree"} ⌘E
									</Tooltip.Content>
								</Tooltip.Positioner>
							</Portal>
						</Tooltip.Root>
					)}
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<Text
								as="span"
								fontWeight="semibold"
								cursor="default"
							>
								{projectName}
							</Text>
						</Tooltip.Trigger>
						<Portal>
							<Tooltip.Positioner>
								<Tooltip.Content>
									<Text as="span" fontSize="xs">
										{profile.worktree_path}
									</Text>
								</Tooltip.Content>
							</Tooltip.Positioner>
						</Portal>
					</Tooltip.Root>
					{isRepo && (
						<Box>
							{profile.is_default ? (
								isActive ? (
									<Suspense>
										<DefaultProfileBranchAndChanges
											cwd={profile.worktree_path}
											profileId={profile.id}
											isActive={isActive}
											onOpen={() => togglePanel(profile.id)}
										/>
									</Suspense>
								) : null
							) : (
								<BranchAndChangesButton
									branchName={profile.branch_name}
									profileId={profile.id}
									isActive={isActive}
									onOpen={() => togglePanel(profile.id)}
								/>
							)}
						</Box>
					)}
				</HStack>
				<HStack gap="2">
					{visibleActiveControls.map((controlId) => {
						const def = controlRegistry.get(controlId);
						if (!def) return null;
						const Comp = def.component;
						return (
							<Comp
								key={controlId}
								profile={profile}
								isActive={isActive}
								options={controlOptions[controlId] ?? {}}
							/>
						);
					})}
					<Tooltip.Root>
						<Tooltip.Trigger asChild>
							<IconButton
								aria-label={m.projectSettings()}
								size="xs"
								variant="subtle"
								onClick={() => setSettingsOpen(true)}
							>
								<FiSettings />
							</IconButton>
						</Tooltip.Trigger>
						<Portal>
							<Tooltip.Positioner>
								<Tooltip.Content>
									{m.projectSettings()}
								</Tooltip.Content>
							</Tooltip.Positioner>
						</Portal>
					</Tooltip.Root>
				</HStack>
			</Flex>

			<ProjectSettingsDialog
				isOpen={settingsOpen}
				onClose={() => setSettingsOpen(false)}
				projectId={projectId}
			/>
		</>
	);
}
