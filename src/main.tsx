import { ChakraProvider } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import AppRoot from "./AppRoot";
import { onReactRender, syncPerformanceProfileFromBackend } from "./features/debug/performanceProfile";
import { queryClient } from "./shared/lib/queryClient";
import { ThemeProvider } from "./shared/providers/ThemeProvider";
import { Toaster } from "./shared/providers/Toaster";
import { appSystem } from "./theme/system";
import "./features/debug/performanceProfileStore";
import "./features/watcher/fileWatcher";

void syncPerformanceProfileFromBackend().catch((error) => {
	console.error("Failed to sync performance profiling state on startup", error);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<ChakraProvider value={appSystem}>
				<ThemeProvider>
					<BrowserRouter>
						<React.Profiler id="AppRoot" onRender={onReactRender}>
							<AppRoot />
						</React.Profiler>
					</BrowserRouter>
					<Toaster />
				</ThemeProvider>
			</ChakraProvider>
		</QueryClientProvider>
	</React.StrictMode>,
);
