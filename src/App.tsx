import { Box, Flex } from "@chakra-ui/react";
import { Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import DebugFloat from "./features/debug/DebugFloat";
import { useDebugStore } from "./features/debug/debugStore";
import { useDebugLogger } from "./features/debug/useDebugLogger";
import HomePage from "./features/home/HomePage";
import ProjectDetailPage from "./features/projects/ProjectDetailPage";
import SettingsPage from "./features/settings/SettingsPage";
import TerminalLayer from "./features/terminal/TerminalLayer";
import { useFileWatcher } from "./features/watcher/useFileWatcher";
import AppSidebar from "./layout/AppSidebar";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
import {
	PageError,
	PageSkeleton,
	SidebarSkeleton,
} from "./shared/components/Fallbacks";
import "./app.css";

export default function App() {
	useFileWatcher();
	useDebugLogger();

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			// Cmd+Shift+D (macOS) / Ctrl+Shift+D (other)
			if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key === "D") {
				e.preventDefault();
				useDebugStore.getState().togglePanel();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	return (
		<Flex direction="column" h="full">
			<Flex flex="1" minH="0">
				<Suspense fallback={<SidebarSkeleton />}>
					<AppSidebar />
				</Suspense>
				<Box as="main" flex="1" overflowY="auto" position="relative">
					<ErrorBoundary
						fallback={(error, reset) => (
							<PageError error={error} onRetry={reset} />
						)}
					>
						<Suspense fallback={<PageSkeleton />}>
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
						</Suspense>
					</ErrorBoundary>

					{/* Persistent terminal layer — survives route changes */}
					<TerminalLayer />
				</Box>
			</Flex>
			<DebugFloat />
		</Flex>
	);
}
