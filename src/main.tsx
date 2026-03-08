import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { queryClient } from "./shared/lib/queryClient";
import { initLogger } from "./shared/lib/logger";
import { ThemeProvider } from "./shared/providers/ThemeProvider";
import { Toaster } from "./shared/providers/Toaster";
import "./features/watcher/fileWatcher";

// Initialize Tauri logger integration
initLogger();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<ChakraProvider value={defaultSystem}>
				<ThemeProvider>
					<BrowserRouter>
						<App />
					</BrowserRouter>
					<Toaster />
				</ThemeProvider>
			</ChakraProvider>
		</QueryClientProvider>
	</React.StrictMode>,
);
