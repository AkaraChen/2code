import { Button, Center, EmptyState, Flex, VStack } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { RiAddLine, RiTerminalBoxLine } from "react-icons/ri";
import { Navigate, useParams } from "react-router";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import { useDefaultProfile, useProject } from "@/features/projects/hooks";
import { useCreateTerminalTab } from "@/features/terminal/hooks";
import { useTerminalStore } from "@/features/terminal/store";
import { listProfiles } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { queryKeys } from "@/shared/lib/queryKeys";

export default function ProjectDetailPage() {
	const { id, profileId: routeProfileId } = useParams<{
		id: string;
		profileId?: string;
	}>();
	const project = useProject(id!);
	const { data: defaultProfile } = useDefaultProfile(id!);

	// Fetch the specific profile if profileId is in the route
	const { data: profiles } = useQuery({
		queryKey: queryKeys.profiles.byProject(id!),
		queryFn: () => listProfiles({ projectId: id! }),
		enabled: !!routeProfileId,
	});
	const routeProfile = routeProfileId
		? profiles?.find((p) => p.id === routeProfileId)
		: undefined;

	const profile = routeProfile ?? defaultProfile;
	const profileId = profile?.id;

	const hasTabs = useTerminalStore(
		(s) => (s.profiles[profileId ?? ""]?.tabs.length ?? 0) > 0,
	);
	const createTab = useCreateTerminalTab();

	if (!project) {
		return <Navigate to="/" replace />;
	}

	// If routeProfileId is specified but profile not found (and profiles have loaded), redirect
	if (routeProfileId && profiles && !routeProfile) {
		return <Navigate to={`/projects/${id}`} replace />;
	}

	// Terminal overlay handles rendering when tabs exist
	if (hasTabs) return null;

	if (!profile) return null;

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
