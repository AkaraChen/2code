import { Box, Flex } from "@chakra-ui/react";
import { useCallback } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useKey } from "rooks";
import DebugFloat from "./features/debug/DebugFloat";
import { useDebugStore } from "./features/debug/debugStore";
import HomePage from "./features/home/HomePage";
import ProjectDetailPage from "./features/projects/ProjectDetailPage";
import SettingsPage from "./features/settings/SettingsPage";
import TerminalLayer from "./features/terminal/TerminalLayer";
import StartupUpdateCheck from "./features/updater/StartupUpdateCheck";
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

	return (
		<Flex
			direction="column"
			h="full"
			bg="var(--app-shell-bg)"
			color="fg"
		>
			<StartupUpdateCheck />
			<Flex flex="1" minH="0">
				<AsyncBoundary
					fallback={<SidebarSkeleton />}
					errorFallback={({ error, onRetry }) => (
						<SidebarError error={error} onRetry={onRetry} />
					)}
				>
					<AppSidebar />
				</AsyncBoundary>
				<Box
					as="main"
					flex="1"
					overflowY="auto"
					position="relative"
					bg="var(--app-shell-panel-bg)"
				>
					<AsyncBoundary
						fallback={<PageSkeleton />}
						errorFallback={({ error, onRetry }) => (
							<PageError error={error} onRetry={onRetry} />
						)}
					>
						<Routes>
							<Route path="/" element={<HomePage />} />
							<Route
								path="/projects/:id/profiles/:profileId"
								element={<ProjectDetailPage />}
							/>
							<Route
								path="/settings"
								element={<SettingsPage />}
							/>
							<Route
								path="*"
								element={<Navigate to="/" replace />}
							/>
						</Routes>
					</AsyncBoundary>

					{/* Persistent terminal layer — survives route changes */}
					<AsyncBoundary
						errorFallback={({ error, onRetry }) => (
							<PageError error={error} onRetry={onRetry} />
						)}
					>
						<TerminalLayer />
					</AsyncBoundary>
				</Box>
			</Flex>
			<DebugFloat />
			{IS_WINDOWS_PLATFORM && <WindowControls />}
		</Flex>
	);
}
