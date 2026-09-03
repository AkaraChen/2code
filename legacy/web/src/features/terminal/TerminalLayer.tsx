import { useSuspenseQuery } from "@tanstack/react-query";
import { use, useCallback, useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { useKey } from "rooks";
import ProfileLayout from "@/features/projects/ProfileLayout";
import { useActiveProfileIds } from "@/features/projects/fileViewerTabsStore";
import type { Profile, ProjectWithProfiles } from "@/generated";
import { listProjects } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";
import { restorationPromise } from "./state";
import { useCloseTerminalTab, useCreateTerminalTab } from "./hooks";
import { useTerminalStore } from "./store";
import { TerminalFileLinkPickerDialog } from "./TerminalFileLinkPickerDialog";
import TerminalTabs from "./TerminalTabs";

export default function TerminalLayer() {
	use(restorationPromise); // Suspense handles the pending state

	const location = useLocation();
	const { data: projects } = useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});

	const activeProfileIds = useActiveProfileIds();
	const { mutate: createTerminalTab } = useCreateTerminalTab();
	const { mutate: closeTerminalTab } = useCloseTerminalTab();

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

	const activeProfileId = useMemo(
		() =>
			matchPath("/projects/:id/profiles/:profileId", location.pathname)
				?.params.profileId ?? null,
		[location.pathname],
	);

	const handleCreateTerminalShortcut = useCallback((e: KeyboardEvent) => {
		if (!e.metaKey || !activeProfileId) return;
		e.preventDefault();
		const profile = profileMap.get(activeProfileId);
		if (!profile) return;
		createTerminalTab({
			profileId: activeProfileId,
			cwd: profile.worktree_path,
		});
	}, [activeProfileId, createTerminalTab, profileMap]);

	const handleCloseTerminalShortcut = useCallback((e: KeyboardEvent) => {
		if (!e.metaKey || !activeProfileId) return;
		e.preventDefault();
		const profileState =
			useTerminalStore.getState().profiles[activeProfileId];
		if (!profileState?.activeTabId) return;
		closeTerminalTab({
			profileId: activeProfileId,
			sessionId: profileState.activeTabId,
		});
	}, [activeProfileId, closeTerminalTab]);

	useKey(["t"], handleCreateTerminalShortcut);
	useKey(["w"], handleCloseTerminalShortcut);

	return (
		<>
			{activeProfileIds.map((profileId) => {
				const profile = profileMap.get(profileId);
				if (!profile) return null;
				const project = projectMap.get(profile.project_id);
				return (
					<div
						key={profileId}
						style={{
							position: "absolute",
							inset: 0,
							display: profileId === activeProfileId ? "flex" : "none",
							flexDirection: "column",
						}}
					>
						<ProfileLayout
							projectId={project?.id ?? profile.project_id}
							projectName={project?.name ?? ""}
							profile={profile}
							isActive={profileId === activeProfileId}
						>
							<TerminalTabs
								projectId={project?.id ?? profile.project_id}
								profileId={profileId}
								cwd={profile.worktree_path}
								profile={profile}
								isActive={profileId === activeProfileId}
							/>
						</ProfileLayout>
					</div>
				);
			})}
			<TerminalFileLinkPickerDialog />
		</>
	);
}
