import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { profilesApi } from "@/api/profiles";
import { projectsApi } from "@/api/projects";
import { useRestoreTerminals } from "@/hooks/useRestoreTerminals";
import { queryKeys } from "@/lib/queryKeys";
import { useTerminalProjectIds, useTerminalSync } from "@/stores/terminalStore";
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

	// Fetch profiles for all projects that have terminal tabs
	const terminalContextIds = useTerminalProjectIds();

	// Collect project IDs that have terminals open (could be project or profile context IDs)
	const projectIdsWithTerminals = useMemo(() => {
		const ids = new Set<string>();
		for (const p of projects ?? []) {
			if (terminalContextIds.includes(p.id)) {
				ids.add(p.id);
			}
		}
		// Also add projects that might have profile terminals
		// We need all projects to look up profiles
		for (const p of projects ?? []) {
			ids.add(p.id);
		}
		return [...ids];
	}, [projects, terminalContextIds]);

	// Fetch profiles for relevant projects
	const { data: allProfiles } = useQuery({
		queryKey: ["profiles", "all-for-terminals", projectIdsWithTerminals],
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
		() => [
			...(projects ?? []).map((p) => ({ id: p.id })),
			...(allProfiles ?? []).map((p) => ({ id: p.id })),
		],
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
				return (
					<div
						key={ctxId}
						className="absolute inset-0"
						style={{
							display:
								ctxId === activeContextId ? "block" : "none",
						}}
					>
						<TerminalTabs
							contextId={ctxId}
							projectId={ctx.projectId}
							cwd={ctx.cwd}
						/>
					</div>
				);
			})}
		</>
	);
}
