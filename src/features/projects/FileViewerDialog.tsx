import {
	Box,
	CloseButton,
	Dialog,
	Flex,
	Portal,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import atomDark from "react-syntax-highlighter/dist/esm/styles/prism/atom-dark";
import dracula from "react-syntax-highlighter/dist/esm/styles/prism/dracula";
import ghcolors from "react-syntax-highlighter/dist/esm/styles/prism/ghcolors";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import solarizedDarkAtom from "react-syntax-highlighter/dist/esm/styles/prism/solarized-dark-atom";
import solarizedLight from "react-syntax-highlighter/dist/esm/styles/prism/solarizedlight";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import { useFileContent } from "./hooks";

// Mirrors the shikiThemeMap in GitDiffDialog — same TerminalThemeId → style mapping
const prismThemeMap: Record<TerminalThemeId, unknown> = {
	"github-dark": vscDarkPlus,
	"github-light": ghcolors,
	dracula: dracula,
	"ayu-dark": atomDark,
	"ayu-light": vs,
	"solarized-dark": solarizedDarkAtom,
	"solarized-light": solarizedLight,
	"one-dark": oneDark,
	"one-light": oneLight,
};

// Map file extension to Prism language identifier
function detectLanguage(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
		rs: "rust",
		py: "python",
		rb: "ruby",
		go: "go",
		java: "java",
		kt: "kotlin",
		swift: "swift",
		c: "c",
		cpp: "cpp",
		cc: "cpp",
		h: "c",
		cs: "csharp",
		sh: "bash",
		zsh: "bash",
		fish: "bash",
		toml: "toml",
		yaml: "yaml",
		yml: "yaml",
		json: "json",
		md: "markdown",
		mdx: "markdown",
		html: "html",
		css: "css",
		scss: "scss",
		sass: "scss",
		sql: "sql",
		graphql: "graphql",
		gql: "graphql",
		xml: "xml",
		dockerfile: "docker",
		tf: "hcl",
		hcl: "hcl",
		lua: "lua",
		php: "php",
		r: "r",
		ex: "elixir",
		exs: "elixir",
		erl: "erlang",
		hs: "haskell",
		elm: "elm",
		clj: "clojure",
		cljs: "clojure",
		vue: "markup",
		svelte: "markup",
		dart: "dart",
		proto: "protobuf",
	};
	// Also handle files with no extension but known names
	const baseName = filename.toLowerCase();
	const nameMap: Record<string, string> = {
		dockerfile: "docker",
		makefile: "makefile",
		"justfile": "makefile",
		".env": "bash",
		".gitignore": "bash",
		".gitattributes": "bash",
	};
	return nameMap[baseName] ?? map[ext] ?? "text";
}

interface FileViewerDialogProps {
	filePath: string | null;
	onClose: () => void;
}

export default function FileViewerDialog({
	filePath,
	onClose,
}: FileViewerDialogProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const prismStyle = prismThemeMap[themeId];

	const { data: content, isLoading, error } = useFileContent(
		filePath ?? "",
		!!filePath,
	);

	const filename = filePath?.split("/").pop() ?? "";
	const language = detectLanguage(filename);

	return (
		<Dialog.Root
			open={!!filePath}
			onOpenChange={(e) => { if (!e.open) onClose(); }}
			size="xl"
		>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content maxH="80vh" display="flex" flexDirection="column">
						<Dialog.Header borderBottomWidth="1px" borderColor="border.subtle" pb="3">
							<Dialog.Title fontFamily="mono" fontSize="sm">
								{filename}
							</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body p="0" overflow="auto" flex="1">
							{isLoading && (
								<Flex align="center" justify="center" h="32">
									<Spinner size="sm" />
								</Flex>
							)}
							{error && (
								<Flex align="center" justify="center" h="32" px="6">
									<Text color="fg.muted" fontSize="sm" textAlign="center">
										{error instanceof Error ? error.message : String(error)}
									</Text>
								</Flex>
							)}
							{content != null && (
								<Box
									css={{
										"& pre": {
											margin: "0 !important",
											borderRadius: "0 !important",
											fontSize: `${fontSize}px !important`,
											fontFamily: `"${fontFamily}", monospace !important`,
										},
									}}
								>
									<SyntaxHighlighter
										language={language}
										style={prismStyle as Record<string, React.CSSProperties>}
										showLineNumbers
										wrapLongLines={false}
										customStyle={{
											margin: 0,
											borderRadius: 0,
											fontSize: `${fontSize}px`,
											fontFamily: `"${fontFamily}", monospace`,
										}}
									>
										{content}
									</SyntaxHighlighter>
								</Box>
							)}
						</Dialog.Body>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
}
