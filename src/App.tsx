import { Box, Flex } from "@chakra-ui/react";
import { Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import SettingsPage from "./features/settings/SettingsPage";
import TerminalLayer from "./features/terminal/TerminalLayer";
import AppSidebar from "./layout/AppSidebar";
import HomePage from "./layout/HomePage";
import ProjectDetailPage from "./layout/ProjectDetailPage";
import { ErrorBoundary } from "./shared/components/ErrorBoundary";
import {
	PageError,
	PageSkeleton,
	SidebarSkeleton,
} from "./shared/components/Fallbacks";
import "./app.css";

export default function App() {
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
									path="/projects/:id"
									element={<ProjectDetailPage />}
								/>
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
		</Flex>
	);
}
