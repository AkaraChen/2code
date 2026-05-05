import { Box, Flex } from "@chakra-ui/react";
import { Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Navigate, Route, Routes } from "react-router";
import { useKey } from "rooks";
import DebugFloat from "./features/debug/DebugFloat";
import { useDebugStore } from "./features/debug/debugStore";
import HomePage from "./features/home/HomePage";
import ProjectDetailPage from "./features/projects/ProjectDetailPage";
import QuickTaskFloat from "./features/quickTasks/QuickTaskFloat";
import SettingsPage from "./features/settings/SettingsPage";
import TerminalLayer from "./features/terminal/TerminalLayer";
import AppSidebar from "./layout/AppSidebar";
import {
	PageError,
	PageSkeleton,
	SidebarSkeleton,
} from "./shared/components/Fallbacks";
import "./app.css";

export default function App() {
	// Cmd+Shift+D (macOS) / Ctrl+Shift+D (other)
	useKey("D", (e) => {
		if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			useDebugStore.getState().togglePanel();
		}
	});

	return (
		<Flex direction="column" h="full">
			<Flex flex="1" minH="0">
				<Suspense fallback={<SidebarSkeleton />}>
					<AppSidebar />
				</Suspense>
				<Box as="main" flex="1" overflowY="auto" position="relative">
					<ErrorBoundary
						fallbackRender={({ error, resetErrorBoundary }) => (
							<PageError
								error={
									error instanceof Error
										? error
										: new Error(String(error))
								}
								onRetry={resetErrorBoundary}
							/>
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
					<Suspense>
						<TerminalLayer />
					</Suspense>
				</Box>
			</Flex>
			<QuickTaskFloat />
			<DebugFloat />
		</Flex>
	);
}
