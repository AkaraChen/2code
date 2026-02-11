import { useQuery } from "@tanstack/react-query";
import { matchPath, useLocation } from "react-router";
import { projectsApi } from "@/api/projects";
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
	const terminalProjectIds = useTerminalProjectIds();

	const match = matchPath("/projects/:id", location.pathname);
	const activeProjectId = match?.params.id ?? null;

	return (
		<>
			{terminalProjectIds.map((id) => {
				const project = projects?.find((p) => p.id === id);
				if (!project) return null;
				return (
					<div
						key={id}
						className="absolute inset-0"
						style={{
							display:
								id === activeProjectId ? "block" : "none",
						}}
					>
						<TerminalTabs
							projectId={id}
							cwd={project.folder}
						/>
					</div>
				);
			})}
		</>
	);
}
