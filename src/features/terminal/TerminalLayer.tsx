import { Box, Flex } from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import type { Profile } from "@/generated";
import { listProfiles, listProjects } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { useRestoreTerminals } from "./hooks";
import { useTerminalProfileIds, useTerminalSync } from "./store";
import TerminalTabs from "./TerminalTabs";

export default function TerminalLayer() {
	const location = useLocation();
	const { data: projects } = useQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});

	const terminalProfileIds = useTerminalProfileIds();

	// Fetch profiles for all projects (includes default profiles)
	const { data: allProfiles } = useQuery({
		queryKey: queryKeys.profiles.all,
		queryFn: async () => {
			const results = await Promise.all(
				(projects ?? []).map((p) => listProfiles({ projectId: p.id })),
			);
			return results.flat();
		},
		enabled: (projects ?? []).length > 0,
	});

	// Build profile lookup map
	const profileMap = useMemo(() => {
		const map = new Map<string, Profile>();
		for (const profile of allProfiles ?? []) {
			map.set(profile.id, profile);
		}
		return map;
	}, [allProfiles]);

	useTerminalSync(allProfiles ?? []);
	useRestoreTerminals(projects);

	// Match routes: /projects/:id or /projects/:id/profiles/:profileId
	const projectMatch = matchPath("/projects/:id", location.pathname);
	const profileMatch = matchPath(
		"/projects/:id/profiles/:profileId",
		location.pathname,
	);

	// Resolve active profile ID
	let activeProfileId: string | null = null;
	if (profileMatch?.params.profileId) {
		activeProfileId = profileMatch.params.profileId;
	} else if (projectMatch?.params.id) {
		// Find default profile for this project
		const defaultProfile = (allProfiles ?? []).find(
			(p) => p.project_id === projectMatch.params.id && p.is_default,
		);
		activeProfileId = defaultProfile?.id ?? null;
	}

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
