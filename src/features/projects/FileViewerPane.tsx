import {
	Box,
	CloseButton,
	Flex,
	HStack,
	IconButton,
	Input,
	Spinner,
	Text,
} from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useEffectEvent, useRef } from "react";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { isSearchShortcut, useSearch } from "@/shared/hooks/useSearch";
import { getPrismTheme } from "./prismThemes";
import { useFileContent } from "./hooks";

function detectLanguage(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		mts: "tsx",
		cts: "typescript",
		mtsx: "tsx",
		ctsx: "tsx",
		js: "javascript",
		mjs: "javascript",
		cjs: "javascript",
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
	const baseName = filename.toLowerCase();
	const nameMap: Record<string, string> = {
		dockerfile: "docker",
		makefile: "makefile",
		justfile: "makefile",
		".env": "bash",
		".gitignore": "bash",
		".gitattributes": "bash",
	};
	return nameMap[baseName] ?? map[ext] ?? "text";
}

function isEditableElement(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	const tagName = target.tagName;
	return (
		target.isContentEditable ||
		tagName === "INPUT" ||
		tagName === "TEXTAREA" ||
		tagName === "SELECT"
	);
}

interface FileViewerPaneProps {
	filePath: string;
}

export default function FileViewerPane({ filePath }: FileViewerPaneProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const prismStyle = getPrismTheme(themeId);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const { data: content, isLoading, error } = useFileContent(filePath, true);

	const filename = filePath.split("/").pop() ?? "";
	const language = detectLanguage(filename);
	const {
		currentMatchIndex,
		currentMatchLine,
		handleCloseSearch,
		handleNextMatch,
		handleOpenSearch,
		handlePreviousMatch,
		handleSearchChange,
		handleSearchInputKeyDown,
		isSearchOpen,
		matchLabel,
		matchedLineNumbers,
		matches,
		searchFocusRequest,
		searchQuery,
	} = useSearch(content ?? "");

	const handleOpenSearchFromShortcut = useEffectEvent(() => {
		handleOpenSearch();
	});

	useEffect(() => {
		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || !isSearchShortcut(event)) return;

			const pane = paneRef.current;
			if (!pane || pane.getClientRects().length === 0) return;
			if (
				event.target instanceof Node &&
				!pane.contains(event.target) &&
				isEditableElement(event.target)
			) {
				return;
			}

			event.preventDefault();
			handleOpenSearchFromShortcut();
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => window.removeEventListener("keydown", handleWindowKeyDown);
	}, []);

	useEffect(() => {
		if (!isSearchOpen || searchFocusRequest === 0) return;

		const frame = window.requestAnimationFrame(() => {
			searchInputRef.current?.focus({ preventScroll: true });
			searchInputRef.current?.select();
		});

		return () => window.cancelAnimationFrame(frame);
	}, [isSearchOpen, searchFocusRequest]);

	useEffect(() => {
		if (!isSearchOpen || currentMatchLine == null) return;

		const line = scrollRef.current?.querySelector<HTMLElement>(
			`[data-search-line="${currentMatchLine}"]`,
		);
		line?.scrollIntoView?.({ block: "center", inline: "nearest" });
	}, [currentMatchIndex, currentMatchLine, isSearchOpen]);

	if (isLoading) {
		return (
			<Flex align="center" justify="center" h="32">
				<Spinner size="sm" />
			</Flex>
		);
	}

	if (error) {
		return (
			<Flex align="center" justify="center" h="32" px="6">
				<Text color="fg.muted" fontSize="sm" textAlign="center">
					{error instanceof Error ? error.message : String(error)}
				</Text>
			</Flex>
		);
	}

	if (content == null) return null;

	return (
		<Box
			h="full"
			overflow="hidden"
			position="relative"
			ref={paneRef}
		>
			<AnimatePresence initial={false}>
				{isSearchOpen && (
					<Box
						asChild
						position="absolute"
						top="3"
						right="4"
						zIndex="1"
					>
						<motion.div
							initial={{ opacity: 0, y: -6, scale: 0.98 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: -6, scale: 0.98 }}
							transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
						>
							<HStack
								gap="1"
								p="1"
								rounded="l2"
								borderWidth="1px"
								borderColor="border.emphasized"
								bg="bg.panel"
								boxShadow="lg"
							>
								<Input
									ref={searchInputRef}
									type="search"
									size="xs"
									w="44"
									value={searchQuery}
									placeholder="Find in file"
									aria-label="Find in file"
									autoComplete="off"
									onChange={handleSearchChange}
									onKeyDown={handleSearchInputKeyDown}
								/>
								<Text
									minW="9"
									textAlign="right"
									fontSize="xs"
									color="fg.muted"
								>
									{matchLabel}
								</Text>
								<IconButton
									size="2xs"
									variant="ghost"
									aria-label="Previous match"
									disabled={matches.length === 0}
									onClick={handlePreviousMatch}
								>
									<FiChevronUp />
								</IconButton>
								<IconButton
									size="2xs"
									variant="ghost"
									aria-label="Next match"
									disabled={matches.length === 0}
									onClick={handleNextMatch}
								>
									<FiChevronDown />
								</IconButton>
								<CloseButton
									size="2xs"
									aria-label="Close file search"
									onClick={handleCloseSearch}
								/>
							</HStack>
						</motion.div>
					</Box>
				)}
			</AnimatePresence>

			<Box
				ref={scrollRef}
				h="full"
				overflow="auto"
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
					style={prismStyle}
					showLineNumbers
					wrapLines
					lineProps={(lineNumber) => {
						const isMatch = matchedLineNumbers.has(lineNumber);
						const isCurrentMatch = currentMatchLine === lineNumber;

						return {
							"data-search-line": isMatch ? String(lineNumber) : undefined,
							style: {
								display: "block",
								backgroundColor: isCurrentMatch
									? "rgba(56, 189, 248, 0.28)"
									: isMatch
										? "rgba(250, 204, 21, 0.18)"
										: undefined,
							},
						};
					}}
					wrapLongLines={false}
					customStyle={{
						margin: 0,
						borderRadius: 0,
						minHeight: "100%",
						fontSize: `${fontSize}px`,
						fontFamily: `"${fontFamily}", monospace`,
					}}
				>
					{content}
				</SyntaxHighlighter>
			</Box>
		</Box>
	);
}
