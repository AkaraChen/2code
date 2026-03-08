import { Box, Flex } from "@chakra-ui/react";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Navigate, Route, Routes } from "react-router";
import { useKey } from "rooks";
import DebugFloat from "./features/debug/DebugFloat";
import { useDebugStore } from "./features/debug/debugStore";
import HomePage from "./features/home/HomePage";
import TerminalLayer from "./features/terminal/TerminalLayer";

const AssetsLayout = lazy(() => import("./features/assets/AssetsLayout"));
const ListSkillsPage = lazy(
	() => import("./features/assets/pages/ListSkillsPage"),
);
const InstallSkillPage = lazy(
	() => import("./features/assets/pages/InstallSkillPage"),
);
const ListAgentsPage = lazy(
	() => import("./features/assets/pages/ListAgentsPage"),
);
const InstallAgentPage = lazy(
	() => import("./features/assets/pages/InstallAgentPage"),
);
const ListSnippetsPage = lazy(
	() => import("./features/assets/pages/ListSnippetsPage"),
);
const InstallSnippetPage = lazy(
	() => import("./features/assets/pages/InstallSnippetPage"),
);
const ProjectDetailPage = lazy(
	() => import("./features/projects/ProjectDetailPage"),
);
const SettingsPage = lazy(() => import("./features/settings/SettingsPage"));

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
									path="/assets"
									element={<AssetsLayout />}
								>
									<Route
										index
										element={
											<Navigate
												to="/assets/manage/skills"
												replace
											/>
										}
									/>
									<Route
										path="manage"
										element={
											<Navigate
												to="/assets/manage/skills"
												replace
											/>
										}
									/>
									<Route
										path="manage/skills"
										element={<ListSkillsPage />}
									/>
									<Route
										path="manage/agents"
										element={<ListAgentsPage />}
									/>
									<Route
										path="manage/snippets"
										element={<ListSnippetsPage />}
									/>
									<Route
										path="store"
										element={
											<Navigate
												to="/assets/store/agents"
												replace
											/>
										}
									/>
									<Route
										path="store/skills"
										element={<InstallSkillPage />}
									/>
									<Route
										path="store/agents"
										element={<InstallAgentPage />}
									/>
									<Route
										path="store/snippets"
										element={<InstallSnippetPage />}
									/>
								</Route>
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
			<DebugFloat />
		</Flex>
	);
}
