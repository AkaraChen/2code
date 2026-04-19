import {
	Box,
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
import GitDiffDialog from "@/features/git/GitDiffDialog";
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

const FILE_TREE_TOGGLE_ICON_TRANSITION = {
	type: "spring",
	stiffness: 360,
	damping: 28,
	mass: 0.55,
} as const;

function GitBranchLabel({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<HStack gap="1">
			<FiGitBranch />
			<Text as="span">{branch}</Text>
		</HStack>
	);
}

function GitDiffDialogWithBranch({
	cwd,
	isOpen,
	isActive,
	onClose,
	profileId,
	worktreePath,
}: {
	cwd: string;
	isOpen: boolean;
	isActive: boolean;
	onClose: () => void;
	profileId: string;
	worktreePath: string;
}) {
	const { data: branch } = useGitBranch(cwd, isOpen && isActive);
	return (
		<GitDiffDialog
			isOpen={isOpen}
			onClose={onClose}
			profileId={profileId}
			worktreePath={worktreePath}
			branchName={branch ?? undefined}
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
	const { data: supportedAppIds = [] } = useSupportedTopbarAppIds();
	const prefersReducedMotion = useReducedMotion() ?? false;

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "g") {
				e.preventDefault();
				setGitDiffOpen(true);
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "e") {
				e.preventDefault();
				onToggleFileTree?.();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isActive, onToggleFileTree]);
	const supportedControlIdSet = new Set(
		getSupportedControlIds(supportedAppIds),
	);
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
					<Box color="fg.muted">
						{profile.is_default ? (
							isActive ? (
								<Suspense>
									<GitBranchLabel
										cwd={profile.worktree_path}
									/>
								</Suspense>
							) : null
						) : (
							<HStack gap="1">
								<FiGitBranch />
								<Text as="span">{profile.branch_name}</Text>
							</HStack>
						)}
					</Box>
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
								options={{
									...(controlOptions[controlId] ?? {}),
									...(controlId === "git-diff"
										? { onOpen: () => setGitDiffOpen(true) }
										: {}),
								}}
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

			{profile.is_default ? (
				<Suspense>
					<GitDiffDialogWithBranch
						cwd={profile.worktree_path}
						isOpen={gitDiffOpen}
						isActive={isActive}
						onClose={() => setGitDiffOpen(false)}
						profileId={profile.id}
						worktreePath={profile.worktree_path}
					/>
				</Suspense>
			) : (
				<GitDiffDialog
					isOpen={gitDiffOpen}
					onClose={() => setGitDiffOpen(false)}
					profileId={profile.id}
					worktreePath={profile.worktree_path}
					branchName={profile.branch_name}
				/>
			)}
		</>
	);
}
