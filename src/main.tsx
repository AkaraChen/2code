import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { Toaster } from "./components/Toaster";
import { queryClient } from "./lib/queryClient";

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
