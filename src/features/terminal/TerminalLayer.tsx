import { Box, Flex } from "@chakra-ui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import type { Profile, ProjectWithProfiles } from "@/generated";
import { listProjects } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useRestoreTerminals } from "./hooks";
import { useTerminalProfileIds, useTerminalSync } from "./store";
import TerminalTabs from "./TerminalTabs";

export default function TerminalLayer() {
	const location = useLocation();
	const { data: projects } = useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});

	const terminalProfileIds = useTerminalProfileIds();

	// Derive all profiles from the projects response (no N+1)
	const allProfiles = useMemo(
		() => (projects ?? []).flatMap((p: ProjectWithProfiles) => p.profiles),
		[projects],
	);

	// Build profile lookup map
	const profileMap = useMemo(() => {
		const map = new Map<string, Profile>();
		for (const profile of allProfiles) {
			map.set(profile.id, profile);
		}
		return map;
	}, [allProfiles]);

	useTerminalSync(allProfiles);
	useRestoreTerminals(projects);

	// Only match /projects/:id/profiles/:profileId
	const profileMatch = matchPath(
		"/projects/:id/profiles/:profileId",
		location.pathname,
	);
	const activeProfileId = profileMatch?.params.profileId ?? null;

	return (
		<>
			{terminalProfileIds.map((profileId) => {
				const profile = profileMap.get(profileId);
				if (!profile) return null;
				const project = projects?.find(
					(p) => p.id === profile.project_id,
				);
				return (
					<Flex
						key={profileId}
						position="absolute"
						inset="0"
						direction="column"
						display={
							profileId === activeProfileId ? "flex" : "none"
						}
					>
						<ProjectTopBar
							projectName={project?.name ?? ""}
							profile={profile}
						/>
						<Box flex="1" minH="0">
							<TerminalTabs
								profileId={profileId}
								cwd={profile.worktree_path}
							/>
						</Box>
					</Flex>
				);
			})}
		</>
	);
}
