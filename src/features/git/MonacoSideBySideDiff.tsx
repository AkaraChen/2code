// Diff viewer that switches between two layouts based on what's present:
//
//   - Both sides present  → Monaco DiffEditor side-by-side / inline.
//   - One side present    → plain Monaco Editor with a single header
//                            ("Added" / "Deleted") and full syntax
//                            highlighting. No diff gutters since there
//                            is nothing to compare against.
//
// Pass `original` or `modified` as `null` to indicate the side doesn't
// exist (added file = no original; deleted file = no modified). Pass `""`
// only for an actually-empty file at that revision.

import "@/shared/lib/monaco";

import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import type { DiffOnMount, OnMount } from "@monaco-editor/react";
import { useCallback, useMemo, useRef } from "react";

import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { detectMonacoLanguage } from "@/shared/lib/languageDetection";

interface MonacoSideBySideDiffProps {
	filePath: string;
	original: string | null;
	modified: string | null;
	mode: "side-by-side" | "inline";
}

function getMonacoTheme(themeId: string) {
	return themeId.includes("light") ? "light" : "vs-dark";
}

export default function MonacoSideBySideDiff({
	filePath,
	original,
	modified,
	mode,
}: MonacoSideBySideDiffProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const language = useMemo(() => detectMonacoLanguage(filePath), [filePath]);
	const theme = getMonacoTheme(themeId);

	const onlyOneSide = original === null || modified === null;
	const presentContent = original ?? modified ?? "";
	const presentKind: "added" | "deleted" | null =
		original === null && modified !== null
			? "added"
			: modified === null && original !== null
				? "deleted"
				: null;

	if (onlyOneSide) {
		return (
			<SinglePaneViewer
				filePath={filePath}
				content={presentContent}
				language={language}
				theme={theme}
				fontFamily={fontFamily}
				fontSize={fontSize}
				kind={presentKind}
			/>
		);
	}

	return (
		<TwoPaneDiff
			original={original ?? ""}
			modified={modified ?? ""}
			language={language}
			theme={theme}
			fontFamily={fontFamily}
			fontSize={fontSize}
			mode={mode}
		/>
	);
}

function TwoPaneDiff({
	original,
	modified,
	language,
	theme,
	fontFamily,
	fontSize,
	mode,
}: {
	original: string;
	modified: string;
	language: string;
	theme: string;
	fontFamily: string;
	fontSize: number;
	mode: "side-by-side" | "inline";
}) {
	const editorRef = useRef<unknown>(null);
	const onMount: DiffOnMount = useCallback((editor) => {
		editorRef.current = editor;
	}, []);

	return (
		<Box width="full" height="full" minH="0">
			<DiffEditor
				original={original}
				modified={modified}
				language={language}
				theme={theme}
				onMount={onMount}
				loading={<DiffLoading />}
				options={{
					readOnly: true,
					originalEditable: false,
					renderSideBySide: mode === "side-by-side",
					// Default 900 — Monaco silently collapses side-by-side to
					// inline below this width. Lower so we only collapse on
					// truly cramped layouts.
					renderSideBySideInlineBreakpoint: 400,
					useInlineViewWhenSpaceIsLimited: false,
					renderOverviewRuler: false,
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					automaticLayout: true,
					fontFamily,
					fontSize,
					lineNumbers: "on",
					glyphMargin: true,
					folding: false,
					wordWrap: "off",
					renderWhitespace: "none",
					ignoreTrimWhitespace: false,
					diffWordWrap: "off",
				}}
			/>
		</Box>
	);
}

function SinglePaneViewer({
	filePath,
	content,
	language,
	theme,
	fontFamily,
	fontSize,
	kind,
}: {
	filePath: string;
	content: string;
	language: string;
	theme: string;
	fontFamily: string;
	fontSize: number;
	kind: "added" | "deleted" | null;
}) {
	const editorRef = useRef<unknown>(null);
	const onMount: OnMount = useCallback((editor) => {
		editorRef.current = editor;
	}, []);

	return (
		<Flex direction="column" h="full" minH="0">
			{kind && (
				<Flex
					align="center"
					gap="2"
					px="3"
					py="1"
					borderBottomWidth="1px"
					borderColor="border.subtle"
					bg={kind === "added" ? "green.subtle" : "red.subtle"}
					flexShrink={0}
				>
					<Text fontSize="xs" fontWeight="medium">
						{kind === "added" ? "Added" : "Deleted"}
					</Text>
					<Text fontSize="xs" color="fg.muted" truncate>
						{filePath}
					</Text>
				</Flex>
			)}
			<Box flex="1" minH="0">
				<Editor
					value={content}
					language={language}
					theme={theme}
					onMount={onMount}
					loading={<DiffLoading />}
					options={{
						readOnly: true,
						minimap: { enabled: false },
						scrollBeyondLastLine: false,
						automaticLayout: true,
						fontFamily,
						fontSize,
						lineNumbers: "on",
						glyphMargin: false,
						folding: false,
						wordWrap: "off",
						renderWhitespace: "none",
					}}
				/>
			</Box>
		</Flex>
	);
}

function DiffLoading() {
	return (
		<Box
			display="flex"
			alignItems="center"
			justifyContent="center"
			height="full"
		>
			<Spinner size="sm" />
		</Box>
	);
}
