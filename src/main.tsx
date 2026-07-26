import { IconContext } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import AppRoot from "./AppRoot";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import {
	onReactRender,
	syncPerformanceProfileFromBackend,
} from "./features/debug/performanceProfile";
import SettingsWindow from "./features/settings/LazySettingsWindow";
// Keeps settings stores live-synced between the main and settings windows.
import "./features/settings/stores/crossWindowSync";
import { queryClient } from "./shared/lib/queryClient";
import { ThemeProvider } from "./shared/providers/ThemeProvider";

const iconDefaults = { size: "1em", weight: "duotone" } as const;

const isSettingsWindow = getCurrentWebviewWindow().label === "settings";

// Main-window-only side effects — the settings window must not start a
// second file watcher or profiling sync.
if (!isSettingsWindow) {
	void import("./features/debug/performanceProfileStore");
	void import("./features/watcher/fileWatcher");
	void syncPerformanceProfileFromBackend().catch((error) => {
		console.error(
			"Failed to sync performance profiling state on startup",
			error,
		);
	});
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<IconContext value={iconDefaults}>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<TooltipProvider>
						<BrowserRouter>
							<React.Profiler
								id="AppRoot"
								onRender={onReactRender}
							>
								{isSettingsWindow ? (
									<React.Suspense fallback={null}>
										<SettingsWindow />
									</React.Suspense>
								) : (
									<AppRoot />
								)}
							</React.Profiler>
						</BrowserRouter>
						<Toaster />
					</TooltipProvider>
				</ThemeProvider>
			</QueryClientProvider>
		</IconContext>
	</React.StrictMode>,
);
