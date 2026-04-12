import {
	Box,
	Flex,
	HStack,
	IconButton,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { Suspense, useEffect, useState } from "react";
import { FiGitBranch, FiSettings } from "react-icons/fi";
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
}: {
	cwd: string;
	isOpen: boolean;
	isActive: boolean;
	onClose: () => void;
	profileId: string;
}) {
	const { data: branch } = useGitBranch(cwd, isOpen && isActive);
	return (
		<GitDiffDialog
			isOpen={isOpen}
			onClose={onClose}
			profileId={profileId}
			branchName={branch ?? undefined}
		/>
	);
}

interface ProjectTopBarProps {
	projectId: string;
	projectName: string;
	profile: Profile;
	isActive: boolean;
}

export default function ProjectTopBar({
	projectId,
	projectName,
	profile,
	isActive,
}: ProjectTopBarProps) {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const controlOptions = useTopBarStore((s) => s.controlOptions);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [gitDiffOpen, setGitDiffOpen] = useState(false);
	const { data: supportedAppIds = [] } = useSupportedTopbarAppIds();

	useEffect(() => {
		if (!isActive) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "g") {
				e.preventDefault();
				setGitDiffOpen(true);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isActive]);
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
					/>
				</Suspense>
			) : (
				<GitDiffDialog
					isOpen={gitDiffOpen}
					onClose={() => setGitDiffOpen(false)}
					profileId={profile.id}
					branchName={profile.branch_name}
				/>
			)}
		</>
	);
}
