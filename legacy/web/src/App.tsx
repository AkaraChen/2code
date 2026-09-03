import { Profiler, useCallback } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useKey } from "rooks";
import DebugFloat from "./features/debug/DebugFloat";
import { useDebugStore } from "./features/debug/debugStore";
import { onReactRender } from "./features/debug/performanceProfile";
import HomePage from "./features/home/HomePage";
import ProjectDetailPage from "./features/projects/ProjectDetailPage";
import TerminalLayer from "./features/terminal/TerminalLayer";
import StartupUpdateCheck from "./features/updater/StartupUpdateCheck";
import { openSettingsWindow } from "./generated";
import AppSidebar from "./layout/AppSidebar";
import WindowControls from "./layout/WindowControls";
import {
	AsyncBoundary,
	PageError,
	PageSkeleton,
	SidebarError,
	SidebarSkeleton,
} from "./shared/components/Fallbacks";
import { isWindowsPlatform } from "./shared/lib/platform";
import "./app.css";

const IS_WINDOWS_PLATFORM = isWindowsPlatform();

export default function App() {
	const handleDebugShortcut = useCallback((e: KeyboardEvent) => {
		if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			useDebugStore.getState().togglePanel();
		}
	}, []);

	// Cmd+Shift+D (macOS) / Ctrl+Shift+D (other)
	useKey("D", handleDebugShortcut);

	const handleSettingsShortcut = useCallback((e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey) {
			e.preventDefault();
			void openSettingsWindow();
		}
	}, []);

	// Cmd+, (macOS) / Ctrl+, (other) — settings opens in its own window
	useKey(",", handleSettingsShortcut);

	return (
		<div className="flex h-full flex-col bg-background text-foreground">
			<StartupUpdateCheck />
			<div className="flex min-h-0 flex-1">
				<AsyncBoundary
					fallback={<SidebarSkeleton />}
					errorFallback={({ error, onRetry }) => (
						<SidebarError error={error} onRetry={onRetry} />
					)}
				>
					<Profiler id="Sidebar" onRender={onReactRender}>
						<AppSidebar />
					</Profiler>
				</AsyncBoundary>
				<main className="relative flex-1 overflow-y-auto bg-card">
					<AsyncBoundary
						fallback={<PageSkeleton />}
						errorFallback={({ error, onRetry }) => (
							<PageError error={error} onRetry={onRetry} />
						)}
					>
						<Profiler id="Routes" onRender={onReactRender}>
							<Routes>
								<Route path="/" element={<HomePage />} />
								<Route
									path="/projects/:id/profiles/:profileId"
									element={<ProjectDetailPage />}
								/>
								<Route
									path="*"
									element={<Navigate to="/" replace />}
								/>
							</Routes>
						</Profiler>
					</AsyncBoundary>

					{/* Persistent terminal layer — survives route changes */}
					<AsyncBoundary
						errorFallback={({ error, onRetry }) => (
							<PageError error={error} onRetry={onRetry} />
						)}
					>
						<Profiler id="TerminalLayer" onRender={onReactRender}>
							<TerminalLayer />
						</Profiler>
					</AsyncBoundary>
				</main>
			</div>
			<DebugFloat />
			{IS_WINDOWS_PLATFORM && <WindowControls />}
		</div>
	);
}
