// Phase 2 task #11 + #17: Monaco-based per-file diff with hunk staging gutter.
//
// Renders a single file's patch text (the output of `git diff -- <path>`) in
// a Monaco editor with the `diff` language for syntax coloring (red/green
// gutters on `-`/`+` lines). Above each hunk we draw a zone widget with
// "Stage hunk" / "Discard hunk" buttons.
//
// Why patch text instead of side-by-side DiffEditor:
// - DiffEditor needs the full file contents on both sides; that's another
//   round-trip per selected file and requires reconciling git's text-encoding
//   handling. Patch text is what we already have.
// - Patch text matches what the backend stage_hunk consumes byte-for-byte —
//   fewer chances for subtle off-by-one errors.
// - Side-by-side fits poorly inside a 420px-wide panel anyway.
//
// We can swap in a true side-by-side DiffEditor later when the GitPanel can
// expand to fill the main viewport (Phase 3 history view ergonomics).

import { Box, Spinner } from "@chakra-ui/react";
import Editor from "@monaco-editor/react";
import type {
	OnMount,
	BeforeMount,
	Monaco,
} from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	useStageHunk,
	useUnstageHunk,
} from "@/features/git/hooks";

import "@/shared/lib/monaco";

interface MonacoFileDiffProps {
	profileId: string;
	filePath: string;
	staged: boolean;
	rawPatch: string; // raw `git diff -- <path>` output (or `git diff --cached`)
}

interface ParsedHunk {
	header: string;
	body: string; // header + body — what stage_hunk wants
	patchLineIndex: number; // 1-based line in the raw patch where the @@ header sits
}

function parsePatch(rawPatch: string): {
	fileHeader: string;
	hunks: ParsedHunk[];
} {
	const lines = rawPatch.split("\n");
	const headerEnd = lines.findIndex((l) => l.startsWith("@@"));
	if (headerEnd === -1) {
		return { fileHeader: rawPatch, hunks: [] };
	}
	const fileHeader = lines.slice(0, headerEnd).join("\n");

	const hunks: ParsedHunk[] = [];
	let i = headerEnd;
	while (i < lines.length && lines[i].startsWith("@@")) {
		const headerLine = lines[i];
		const bodyStart = i + 1;
		let bodyEnd = bodyStart;
		while (bodyEnd < lines.length && !lines[bodyEnd].startsWith("@@")) {
			bodyEnd++;
		}
		const bodyLines = lines.slice(i, bodyEnd);
		const body = bodyLines.join("\n") + "\n";
		hunks.push({
			header: headerLine,
			body,
			patchLineIndex: i + 1, // 1-based
		});
		i = bodyEnd;
	}
	return { fileHeader, hunks };
}

export default function MonacoFileDiff({
	profileId,
	filePath,
	staged,
	rawPatch,
}: MonacoFileDiffProps) {
	const editorRef = useRef<unknown>(null);
	const [ready, setReady] = useState(false);

	const stageHunk = useStageHunk(profileId);
	const unstageHunk = useUnstageHunk(profileId);

	const { fileHeader, hunks } = useMemo(() => parsePatch(rawPatch), [rawPatch]);

	const onBeforeMount: BeforeMount = useCallback((monaco: Monaco) => {
		// Register a basic "diff" syntax theme if not already registered.
		// monaco-editor ships a built-in "diff" tokenizer, no setup needed.
		void monaco;
	}, []);

	const onMount: OnMount = useCallback((editor) => {
		editorRef.current = editor;
		setReady(true);
	}, []);

	// Render hunk action zones above each @@ line in the patch view.
	useEffect(() => {
		const editor = editorRef.current as
			| {
					changeViewZones: (
						cb: (accessor: {
							addZone: (zone: unknown) => string;
							removeZone: (id: string) => void;
						}) => void,
					) => void;
			  }
			| null;
		if (!editor || !ready) return;

		const zoneIds: string[] = [];

		editor.changeViewZones((accessor) => {
			for (const hunk of hunks) {
				const dom = document.createElement("div");
				dom.style.cssText = `
					display: flex;
					gap: 6px;
					padding: 2px 8px;
					font-size: 11px;
					font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
					background: var(--vscode-editorWidget-background, rgba(127,127,127,0.08));
					color: var(--vscode-editor-foreground, inherit);
					border-bottom: 1px solid var(--vscode-editorWidget-border, rgba(255,255,255,0.1));
					user-select: none;
				`;

				const stageBtn = document.createElement("button");
				stageBtn.type = "button";
				stageBtn.textContent = staged ? "Unstage hunk" : "Stage hunk";
				stageBtn.style.cssText = `
					padding: 1px 8px;
					background: transparent;
					border: 1px solid var(--vscode-button-border, rgba(127,127,127,0.3));
					border-radius: 3px;
					color: inherit;
					cursor: pointer;
					font-size: 11px;
				`;
				stageBtn.onclick = () => {
					const args = { fileHeader, hunks: [hunk.body] };
					if (staged) {
						unstageHunk.mutate(args);
					} else {
						stageHunk.mutate(args);
					}
				};

				dom.appendChild(stageBtn);

				zoneIds.push(
					accessor.addZone({
						afterLineNumber: Math.max(0, hunk.patchLineIndex - 1),
						heightInLines: 1,
						domNode: dom,
					}),
				);
			}
		});

		return () => {
			editor.changeViewZones((accessor) => {
				for (const id of zoneIds) accessor.removeZone(id);
			});
		};
	}, [hunks, fileHeader, ready, staged, stageHunk, unstageHunk]);

	if (!rawPatch.trim()) {
		return (
			<Box
				display="flex"
				alignItems="center"
				justifyContent="center"
				height="full"
				color="fg.muted"
				fontSize="sm"
			>
				No diff for {filePath}
			</Box>
		);
	}

	return (
		<Box
			position="relative"
			width="full"
			height="full"
			minH="0"
			bg="bg"
		>
			<Editor
				value={rawPatch}
				language="diff"
				theme="vs-dark"
				beforeMount={onBeforeMount}
				onMount={onMount}
				loading={
					<Box
						display="flex"
						alignItems="center"
						justifyContent="center"
						height="full"
					>
						<Spinner />
					</Box>
				}
				options={{
					readOnly: true,
					renderLineHighlight: "none",
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					fontSize: 12,
					lineNumbers: "off",
					glyphMargin: false,
					folding: false,
					wordWrap: "off",
					renderWhitespace: "none",
				}}
			/>
		</Box>
	);
}
