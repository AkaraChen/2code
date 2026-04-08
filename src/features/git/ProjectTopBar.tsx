import {
	Box,
	Flex,
	HStack,
	IconButton,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { homeDir } from "@tauri-apps/api/path";
import { Suspense, useEffect, useState } from "react";
import { RiGitBranchLine, RiSettings3Line } from "react-icons/ri";
import { useGitBranch } from "@/features/projects/hooks";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import { controlRegistry } from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import * as m from "@/paraglide/messages.js";

function GitBranchLabel({ cwd }: { cwd: string }) {
	const { data: branch } = useGitBranch(cwd);
	if (!branch) return null;
	return (
		<HStack gap="1">
			<RiGitBranchLine />
			<Text as="span">{branch}</Text>
		</HStack>
	);
}

function useShortPath(fullPath: string): string {
	const [shortPath, setShortPath] = useState(fullPath);

	useEffect(() => {
		let cancelled = false;
		void homeDir().then((home) => {
			if (cancelled) return;
			if (home && fullPath.startsWith(home)) {
				setShortPath(`~${fullPath.slice(home.length)}`);
			} else {
				setShortPath(fullPath);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [fullPath]);

	return shortPath;
}

interface ProjectTopBarProps {
	projectId: string;
	projectName: string;
	profile: Profile;
}

export default function ProjectTopBar({
	projectId,
	projectName,
	profile,
}: ProjectTopBarProps) {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const controlOptions = useTopBarStore((s) => s.controlOptions);
	const shortPath = useShortPath(profile.worktree_path);
	const [settingsOpen, setSettingsOpen] = useState(false);

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
							<Text as="span" fontWeight="semibold" cursor="default">
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
					<Text
						as="span"
						color="fg.muted"
						fontSize="xs"
						lineClamp={1}
						maxW="200px"
					>
						{shortPath}
					</Text>
					<Box color="fg.muted">
						{profile.is_default ? (
							<Suspense>
								<GitBranchLabel cwd={profile.worktree_path} />
							</Suspense>
						) : (
							<HStack gap="1">
								<RiGitBranchLine />
								<Text as="span">{profile.branch_name}</Text>
							</HStack>
						)}
					</Box>
				</HStack>
				<HStack gap="2">
					{activeControls.map((controlId) => {
						const def = controlRegistry.get(controlId);
						if (!def) return null;
						const Comp = def.component;
						return (
							<Comp
								key={controlId}
								profile={profile}
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
								<RiSettings3Line />
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
