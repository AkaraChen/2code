import { Routes, Route, Navigate, useLocation, matchPath } from "react-router";
import AppSidebar from "./components/AppSidebar";
import TerminalTabs from "./components/TerminalTabs";
import HomePage from "./pages/HomePage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import SettingsPage from "./pages/SettingsPage";
import { useProjects } from "./contexts/ProjectContext";
import { useTerminalProjectIds, useTerminalSync } from "./stores/terminalStore";
import "./app.css";

export default function App() {
	const location = useLocation();
	const { projects } = useProjects();

	useTerminalSync(projects);
	const terminalProjectIds = useTerminalProjectIds();

	const match = matchPath("/projects/:id", location.pathname);
	const activeProjectId = match?.params.id ?? null;

	return (
		<div className="flex flex-col h-full">
			<div className="flex flex-1 min-h-0">
				<AppSidebar />
				<main className="flex-1 overflow-y-auto relative">
					<Routes>
						<Route path="/" element={<HomePage />} />
						<Route
							path="/projects/:id"
							element={<ProjectDetailPage />}
						/>
						<Route path="/settings" element={<SettingsPage />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>

					{/* Persistent terminal layer — survives route changes */}
					{terminalProjectIds.map((id) => {
						const project = projects.find((p) => p.id === id);
						if (!project) return null;
						return (
							<div
								key={id}
								className="absolute inset-0"
								style={{
									display:
										id === activeProjectId
											? "block"
											: "none",
								}}
							>
								<TerminalTabs
									projectId={id}
									cwd={project.folder}
								/>
							</div>
						);
					})}
				</main>
			</div>
		</div>
	);
}
