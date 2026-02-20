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
import { useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import {
	RiAddLine,
	RiGitBranchLine,
	RiSettings3Line,
	RiTerminalBoxLine,
} from "react-icons/ri";
import AgentMenu from "@/features/git/AgentMenu";
import { useGitBranch } from "@/features/projects/hooks";
import ProjectSettingsDialog from "@/features/projects/ProjectSettingsDialog";
import { useCreateTab } from "@/features/tabs/hooks";
import { controlRegistry } from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import { listAgentStatus } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";

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

interface ProjectTopBarProps {
	projectName: string;
	projectId: string;
	profile: Profile;
}

export default function ProjectTopBar({
	projectName,
	projectId,
	profile,
}: ProjectTopBarProps) {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const controlOptions = useTopBarStore((s) => s.controlOptions);
	const createTab = useCreateTab();
	const [settingsOpen, setSettingsOpen] = useState(false);

	const { data: agents } = useQuery({
		queryKey: queryKeys.agent.status(),
		queryFn: listAgentStatus,
	});

	const readyAgents = agents?.filter((a) => a.ready) ?? [];

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
				<Text as="span" fontWeight="semibold">
					{projectName}
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
				{/* New Terminal button */}
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<Button
							size="xs"
							variant="subtle"
							disabled={createTab.isPending}
							onClick={() =>
								createTab.mutate({
									type: "terminal",
									profileId: profile.id,
									cwd: profile.worktree_path,
								})
							}
						>
							<RiTerminalBoxLine />
							<RiAddLine />
						</Button>
					</Tooltip.Trigger>
					<Portal>
						<Tooltip.Positioner>
							<Tooltip.Content>{m.newTerminal()}</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>

				{/* New Agent button with dropdown */}
				<AgentMenu
					agents={readyAgents}
					profile={profile}
					isPending={createTab.isPending}
					onCreateTab={createTab.mutate}
				/>

				{/* Existing registry controls */}
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

				{/* Project settings */}
				<Tooltip.Root>
					<Tooltip.Trigger asChild>
						<IconButton
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
