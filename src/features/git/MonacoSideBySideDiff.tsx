// Side-by-side / inline diff with full language-aware syntax highlighting.
//
// Uses Monaco's DiffEditor (not the patch text view). Original = HEAD, modified
// = worktree (or index for staged side). Detects language from the file
// extension via the existing detectMonacoLanguage helper, so TypeScript /
// Rust / etc. light up the same way they do in regular file tabs.
//
// Read-only on both sides — this is a viewer, not an editor. Hunk-level
// stage/unstage actions stay in the patch view (MonacoFileDiff). When users
// want to stage hunks they switch to the patch view via the header toggle in
// DiffTabPane.

import "@/shared/lib/monaco";

import { Box, Spinner } from "@chakra-ui/react";
import { DiffEditor } from "@monaco-editor/react";
import type { DiffOnMount } from "@monaco-editor/react";
import { useCallback, useMemo, useRef } from "react";

import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { detectMonacoLanguage } from "@/shared/lib/languageDetection";

interface MonacoSideBySideDiffProps {
	filePath: string;
	original: string;
	modified: string;
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
				theme={getMonacoTheme(themeId)}
				onMount={onMount}
				loading={
					<Box
						display="flex"
						alignItems="center"
						justifyContent="center"
						height="full"
					>
						<Spinner size="sm" />
					</Box>
				}
				options={{
					readOnly: true,
					originalEditable: false,
					renderSideBySide: mode === "side-by-side",
					// Default is 900 — Monaco silently collapses side-by-side to
					// inline when the editor is narrower than this, which makes
					// modified files render as a single pane with no diff
					// indicators on tighter layouts. Lower the threshold so we
					// only collapse on truly cramped widths.
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
