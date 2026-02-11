import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { projectsApi } from "@/api/projects";
import { useRestoreTerminals } from "@/hooks/useRestoreTerminals";
import { queryKeys } from "@/lib/queryKeys";
import { useTerminalProjectIds, useTerminalSync } from "@/stores/terminalStore";
import TerminalTabs from "./TerminalTabs";

export default function TerminalLayer() {
	const location = useLocation();
	const { data: projects } = useQuery({
		queryKey: queryKeys.projects.all,
		queryFn: projectsApi.list,
	});

	useTerminalSync(projects ?? []);
	useRestoreTerminals(projects);
	const terminalProjectIds = useTerminalProjectIds();

	const projectMap = useMemo(
		() => new Map(projects?.map((p) => [p.id, p]) ?? []),
		[projects],
	);

	const match = matchPath("/projects/:id", location.pathname);
	const activeProjectId = match?.params.id ?? null;

	return (
		<>
			{terminalProjectIds.map((id) => {
				const project = projectMap.get(id);
				if (!project) return null;
				return (
					<div
						key={id}
						className="absolute inset-0"
						style={{
							display: id === activeProjectId ? "block" : "none",
						}}
					>
						<TerminalTabs projectId={id} cwd={project.folder} />
					</div>
				);
			})}
		</>
	);
}
