import { Box, Flex } from "@chakra-ui/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { use, useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { useKey } from "rooks";
import ProjectTopBar from "@/features/git/ProjectTopBar";
import FileTreePanel from "@/features/projects/FileTreePanel";
import { useFileTreeStore } from "@/features/projects/fileTreeStore";
import {
	useActiveProfileIds,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import type { Profile, ProjectWithProfiles } from "@/generated";
import { listProjects } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { restorationPromise } from "./state";
import { useCloseTerminalTab, useCreateTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import TerminalTabs from "./TerminalTabs";

export default function TerminalLayer() {
	use(restorationPromise); // Suspense handles the pending state

	const location = useLocation();
	const { data: projects } = useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});

	const activeProfileIds = useActiveProfileIds();
	const createTab = useCreateTerminalTab();
	const closeTab = useCloseTerminalTab();
	const openFileTab = useFileViewerTabsStore((s) => s.openFile);
	const fileTreeOpenProfiles = useFileTreeStore((s) => s.openProfiles);
	const toggleFileTree = useFileTreeStore((s) => s.toggle);
	const fileTreeIsOpen = (profileId: string) =>
		fileTreeOpenProfiles[profileId] ?? true;

	// Build profile lookup map
	const profileMap = useMemo(() => {
		const map = new Map<string, Profile>();
		for (const p of projects ?? []) {
			for (const profile of p.profiles) {
				map.set(profile.id, profile);
			}
		}
		return map;
	}, [projects]);

	// Build project lookup map (avoids O(n*m) Array.find inside render loop)
	const projectMap = useMemo(() => {
		const map = new Map<string, ProjectWithProfiles>();
		for (const p of projects ?? []) {
			map.set(p.id, p);
		}
		return map;
	}, [projects]);

	// Only match /projects/:id/profiles/:profileId
	const profileMatch = matchPath(
		"/projects/:id/profiles/:profileId",
		location.pathname,
	);
	const activeProfileId = profileMatch?.params.profileId ?? null;

	useKey(["t"], (e) => {
		if (!e.metaKey || !activeProfileId) return;
		e.preventDefault();
		const profile = profileMap.get(activeProfileId);
		if (!profile) return;
		createTab.mutate({
			profileId: activeProfileId,
			cwd: profile.worktree_path,
		});
	});

	useKey(["w"], (e) => {
		if (!e.metaKey || !activeProfileId) return;
		e.preventDefault();
		const profileState =
			useTerminalStore.getState().profiles[activeProfileId];
		if (!profileState?.activeTabId) return;
		closeTab.mutate({
			profileId: activeProfileId,
			sessionId: profileState.activeTabId,
		});
	});

	return (
		<>
			{activeProfileIds.map((profileId) => {
				const profile = profileMap.get(profileId);
				if (!profile) return null;
				const project = projectMap.get(profile.project_id);
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
						<Box borderBottomWidth="1px" borderColor="border">
							<ProjectTopBar
								projectId={project?.id ?? profile.project_id}
								projectName={project?.name ?? ""}
								profile={profile}
								isActive={profileId === activeProfileId}
								isFileTreeOpen={fileTreeIsOpen(profileId)}
								onToggleFileTree={() => toggleFileTree(profileId)}
							/>
						</Box>
						<Flex flex="1" minH="0" minW="0">
							<FileTreePanel
								profileId={profileId}
								rootPath={profile.worktree_path}
								isOpen={fileTreeIsOpen(profileId)}
								onOpenFile={(filePath) =>
									openFileTab(profileId, filePath)
								}
							/>
							<Box
								flex="1"
								minH="0"
								minW="0"
								borderLeftWidth={fileTreeIsOpen(profileId) ? "1px" : "0"}
								borderColor="border"
							>
								<TerminalTabs
									projectId={project?.id ?? profile.project_id}
									profileId={profileId}
									cwd={profile.worktree_path}
								/>
							</Box>
						</Flex>
					</Flex>
				);
			})}
		</>
	);
}
