import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { ThemeProvider } from "./components/ThemeProvider";
import { ProjectProvider } from "./contexts/ProjectContext";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		<ChakraProvider value={defaultSystem}>
			<ThemeProvider>
				<BrowserRouter>
					<ProjectProvider>
						<App />
					</ProjectProvider>
				</BrowserRouter>
			</ThemeProvider>
		</ChakraProvider>
	</React.StrictMode>,
);
