import { IconContext } from "@phosphor-icons/react";
import { QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import AppRoot from "./AppRoot";
import { onReactRender, syncPerformanceProfileFromBackend } from "./features/debug/performanceProfile";
import { Toaster } from "./components/ui/sonner";
import { TooltipProvider } from "./components/ui/tooltip";
import { queryClient } from "./shared/lib/queryClient";
import { ThemeProvider } from "./shared/providers/ThemeProvider";
import "./features/debug/performanceProfileStore";
import "./features/watcher/fileWatcher";

const iconDefaults = { weight: "duotone" } as const;

void syncPerformanceProfileFromBackend().catch((error) => {
	console.error("Failed to sync performance profiling state on startup", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<IconContext value={iconDefaults}>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider>
					<TooltipProvider>
						<BrowserRouter>
							<React.Profiler id="AppRoot" onRender={onReactRender}>
								<AppRoot />
							</React.Profiler>
						</BrowserRouter>
						<Toaster />
					</TooltipProvider>
				</ThemeProvider>
			</QueryClientProvider>
		</IconContext>
	</React.StrictMode>,
);
