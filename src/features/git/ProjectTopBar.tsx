import {
	Box,
	Button,
	Flex,
	HStack,
	Portal,
	Text,
	Tooltip,
} from "@chakra-ui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import {
	RiAddLine,
	RiGitBranchLine,
	RiTerminalBoxLine,
} from "react-icons/ri";
import AgentMenu from "@/features/git/AgentMenu";
import { useGitBranch } from "@/features/projects/hooks";
import { useCreateTab } from "@/features/tabs/hooks";
import { controlRegistry } from "@/features/topbar/registry";
import { useTopBarStore } from "@/features/topbar/store";
import type { Profile } from "@/generated";
import { listMarketplaceAgents } from "@/generated";
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
	profile: Profile;
}

export default function ProjectTopBar({
	projectName,
	profile,
}: ProjectTopBarProps) {
	const activeControls = useTopBarStore((s) => s.activeControls);
	const createTab = useCreateTab();

	const { data: agents } = useSuspenseQuery({
		queryKey: queryKeys.marketplace.agents,
		queryFn: listMarketplaceAgents,
	});

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
							aria-label={m.newTerminal()}
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
					agents={agents}
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
						/>
					);
				})}
			</HStack>
		</Flex>
		</>
	);
}
