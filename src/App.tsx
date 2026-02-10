import { Routes, Route, Navigate } from "react-router";
import AppSidebar from "./components/AppSidebar";
import TitleBar from "./components/TitleBar";
import HomePage from "./pages/HomePage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import ProjectsPage from "./pages/ProjectsPage";
import SettingsPage from "./pages/SettingsPage";
import "./app.css";
import "./styles.scss";

export default function App() {
	return (
		<div className="flex flex-col h-full">
			<TitleBar />
			<div className="flex flex-1 min-h-0">
				<AppSidebar />
				<main className="flex-1 p-8 overflow-y-auto relative">
					<Routes>
						<Route path="/" element={<HomePage />} />
						<Route path="/projects" element={<ProjectsPage />} />
						<Route
							path="/projects/:id"
							element={<ProjectDetailPage />}
						/>
						<Route path="/settings" element={<SettingsPage />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>
				</main>
			</div>
		</div>
	);
}
