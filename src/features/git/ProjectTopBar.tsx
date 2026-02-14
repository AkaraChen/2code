import {
	Box,
	Button,
	Flex,
	HStack,
	Menu,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import {
	RiAddLine,
	RiGitBranchLine,
	RiRobot2Line,
	RiTerminalBoxLine,
} from "react-icons/ri";
import { useGitBranch } from "@/features/projects/hooks";
import { useCreateTab } from "@/features/tabs/hooks";
import { controlRegistry } from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import { listAgentStatus } from "@/generated";

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
	profile: Profile;
}

export default function ProjectTopBar({
	projectName,
	profile,
}: ProjectTopBarProps) {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const controlOptions = useTopBarStore((s) => s.controlOptions);
	const createTab = useCreateTab();

	const { data: agents } = useQuery({
		queryKey: ["agent-status"],
		queryFn: listAgentStatus,
		staleTime: 30_000,
	});

	const readyAgents = agents?.filter((a) => a.ready) ?? [];

	return (
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
							size="2xs"
							variant="ghost"
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
							<Tooltip.Content>New Terminal</Tooltip.Content>
						</Tooltip.Positioner>
					</Portal>
				</Tooltip.Root>

				{/* New Agent button with dropdown */}
				{readyAgents.length > 0 && (
					<Menu.Root>
						<Tooltip.Root>
							<Tooltip.Trigger asChild>
								<Menu.Trigger asChild>
									<Button
										size="2xs"
										variant="ghost"
										disabled={createTab.isPending}
									>
										<RiRobot2Line />
										<RiAddLine />
									</Button>
								</Menu.Trigger>
							</Tooltip.Trigger>
							<Portal>
								<Tooltip.Positioner>
									<Tooltip.Content>
										New Agent Session
									</Tooltip.Content>
								</Tooltip.Positioner>
							</Portal>
						</Tooltip.Root>
						<Portal>
							<Menu.Positioner>
								<Menu.Content>
									{readyAgents.map((agent) => (
										<Menu.Item
											key={agent.id}
											value={agent.id}
											onClick={() =>
												createTab.mutate({
													type: "agent",
													profileId: profile.id,
													cwd: profile.worktree_path,
													agent: agent.id,
												})
											}
										>
											<RiRobot2Line />
											{agent.display_name}
										</Menu.Item>
									))}
								</Menu.Content>
							</Menu.Positioner>
						</Portal>
					</Menu.Root>
				)}

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
			</HStack>
		</Flex>
	);
}
