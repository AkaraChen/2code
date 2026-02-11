import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { profilesApi } from "@/api/profiles";
import { projectsApi } from "@/api/projects";
import { useRestoreTerminals } from "@/hooks/useRestoreTerminals";
import { queryKeys } from "@/lib/queryKeys";
import { useTerminalProjectIds, useTerminalSync } from "@/stores/terminalStore";
import ProjectTopBar from "./ProjectTopBar";
import TerminalTabs from "./TerminalTabs";

interface ContextInfo {
	projectId: string;
	cwd: string;
}

export default function TerminalLayer() {
	const location = useLocation();
	const { data: projects } = useQuery({
		queryKey: queryKeys.projects.all,
		queryFn: projectsApi.list,
	});

	const terminalContextIds = useTerminalProjectIds();

	// Fetch profiles for all projects
	const { data: allProfiles } = useQuery({
		queryKey: ["profiles", "all-for-terminals", projects],
		queryFn: async () => {
			const results = await Promise.all(
				(projects ?? []).map((p) => profilesApi.list(p.id)),
			);
			return results.flat();
		},
		enabled: (projects ?? []).length > 0,
	});

	// Build context map: contextId → { projectId, cwd }
	const contextMap = useMemo(() => {
		const map = new Map<string, ContextInfo>();
		for (const p of projects ?? []) {
			map.set(p.id, { projectId: p.id, cwd: p.folder });
		}
		for (const profile of allProfiles ?? []) {
			map.set(profile.id, {
				projectId: profile.project_id,
				cwd: profile.worktree_path,
			});
		}
		return map;
	}, [projects, allProfiles]);

	// Build set of valid IDs for sync (project IDs + profile IDs)
	const validContextIds = useMemo(
		() => [...(projects ?? []), ...(allProfiles ?? [])],
		[projects, allProfiles],
	);

	useTerminalSync(validContextIds);
	useRestoreTerminals(projects, allProfiles ?? []);

	// Match routes: /projects/:id or /projects/:id/profiles/:profileId
	const projectMatch = matchPath("/projects/:id", location.pathname);
	const profileMatch = matchPath(
		"/projects/:id/profiles/:profileId",
		location.pathname,
	);
	const activeContextId =
		profileMatch?.params.profileId ?? projectMatch?.params.id ?? null;

	return (
		<>
			{terminalContextIds.map((ctxId) => {
				const ctx = contextMap.get(ctxId);
				if (!ctx) return null;
				const project = projects?.find((p) => p.id === ctx.projectId);
				const profile =
					ctxId !== ctx.projectId
						? allProfiles?.find((p) => p.id === ctxId)
						: undefined;
				return (
					<div
						key={ctxId}
						className="absolute inset-0 flex flex-col"
						style={{
							display:
								ctxId === activeContextId ? "flex" : "none",
						}}
					>
						<ProjectTopBar
							projectName={project?.name ?? ""}
							profileBranchName={profile?.branch_name}
							cwd={ctx.cwd}
						/>
						<div className="flex-1 min-h-0">
							<TerminalTabs
								contextId={ctxId}
								projectId={ctx.projectId}
								cwd={ctx.cwd}
							/>
						</div>
					</div>
				);
			})}
		</>
	);
}
