import { Button, Center, EmptyState, Flex, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { RiAddLine, RiTerminalBoxLine } from "react-icons/ri";
import { Navigate, useParams } from "react-router";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import { useProject, useProjectProfiles } from "@/features/projects/hooks";
import { useCreateTerminalTab } from "@/features/terminal/hooks";
import { useTerminalStore } from "@/features/terminal/store";
import * as m from "@/paraglide/messages.js";

export default function ProjectDetailPage() {
	const { id, profileId } = useParams<{
		id: string;
		profileId: string;
	}>();
	const project = useProject(id!);
	const profiles = useProjectProfiles(id!);
	const profile = useMemo(
		() => profiles.find((p) => p.id === profileId),
		[profiles, profileId],
	);

	const hasTabs = useTerminalStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const createTab = useCreateTerminalTab();

	if (!project || !profile) {
		return <Navigate to="/" replace />;
	}

	// Terminal overlay handles rendering when tabs exist
	if (hasTabs) return null;

	return (
		<Flex direction="column" h="full">
			<ProjectTopBar projectName={project.name} profile={profile} />
			<Center flex="1">
				<EmptyState.Root>
					<EmptyState.Content>
						<EmptyState.Indicator>
							<RiTerminalBoxLine />
						</EmptyState.Indicator>
						<VStack textAlign="center">
							<EmptyState.Title>
								{m.noTerminalsOpen()}
							</EmptyState.Title>
							<EmptyState.Description>
								{m.noTerminalsOpenDescription()}
							</EmptyState.Description>
						</VStack>
						<Button
							disabled={createTab.isPending}
							onClick={() =>
								createTab.mutate({
									profileId: profile.id,
									cwd: profile.worktree_path,
								})
							}
						>
							<RiAddLine />
							{m.newTerminal()}
						</Button>
					</EmptyState.Content>
				</EmptyState.Root>
			</Center>
		</Flex>
	);
}
