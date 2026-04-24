import "@/shared/lib/monaco";
import {
	Box,
	Flex,
	Spinner,
	Text,
} from "@chakra-ui/react";
import Editor from "@monaco-editor/react";
import type {
	BeforeMount,
	EditorProps,
	OnChange,
	OnMount,
} from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileViewerDirtyStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { detectMonacoLanguage } from "@/shared/lib/languageDetection";
import { useFileContent, useSaveFileContent } from "./hooks";

interface FileViewerPaneProps {
	filePath: string;
	profileId: string;
}

function getMonacoTheme(themeId: string) {
	return themeId.includes("light") ? "light" : "vs-dark";
}

export default function FileViewerPane({
	filePath,
	profileId,
}: FileViewerPaneProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const [draftsByPath, setDraftsByPath] = useState<Record<string, string>>({});
	const [savedValuesByPath, setSavedValuesByPath] = useState<
		Record<string, string>
	>({});
	const paneRef = useRef<HTMLDivElement | null>(null);
	const saveHandlerRef = useRef<() => void>(() => {});
	const setFileDirty = useFileViewerDirtyStore((state) => state.setFileDirty);

	const { data: content, isLoading, error } = useFileContent(filePath, true);
	const {
		isPending: isSaving,
		mutate: saveFileContent,
	} = useSaveFileContent(profileId);

	const filename = filePath.split("/").pop() ?? "";
	const language = detectMonacoLanguage(filename);
	const monacoTheme = getMonacoTheme(themeId);
	const draftValue = draftsByPath[filePath];
	const savedValue = savedValuesByPath[filePath];
	const editorValue = draftValue ?? content ?? "";
	const lastSavedValue = savedValue ?? content ?? "";
	const hasLoadedFile = content != null || draftValue != null;
	const hasUnsavedChanges = editorValue !== lastSavedValue;

	useEffect(() => {
		if (!hasLoadedFile) return;
		setFileDirty(profileId, filePath, hasUnsavedChanges);
	}, [
		filePath,
		hasLoadedFile,
		hasUnsavedChanges,
		profileId,
		setFileDirty,
	]);

	const editorOptions = useMemo<NonNullable<EditorProps["options"]>>(
		() => ({
			automaticLayout: true,
			fontFamily: `"${fontFamily}", monospace`,
			fontLigatures: true,
			fontSize,
			minimap: { enabled: false },
			padding: { top: 12, bottom: 12 },
			renderWhitespace: "selection",
			scrollBeyondLastLine: false,
			wordWrap: "off",
		}),
		[fontFamily, fontSize],
	);

	const handleEditorBeforeMount = useCallback<BeforeMount>((monaco) => {
		const diagnosticsOptions = {
			noSemanticValidation: true,
			noSyntaxValidation: true,
		};
		monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
			diagnosticsOptions,
		);
		monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(
			diagnosticsOptions,
		);
	}, []);

	const handleEditorChange = useCallback<OnChange>(
		(nextValue) => {
			setDraftsByPath((prev) => ({
				...prev,
				[filePath]: nextValue ?? "",
			}));
		},
		[filePath],
	);

	const handleSave = useCallback(() => {
		if (!hasLoadedFile || !hasUnsavedChanges || isSaving) return;

		saveFileContent(
			{ path: filePath, content: editorValue },
			{
				onSuccess: (_result, variables) => {
					setDraftsByPath((prev) => ({
						...prev,
						[variables.path]: variables.content,
					}));
					setSavedValuesByPath((prev) => ({
						...prev,
						[variables.path]: variables.content,
					}));
					setFileDirty(profileId, variables.path, false);
				},
			},
		);
	}, [
		editorValue,
		filePath,
		hasLoadedFile,
		hasUnsavedChanges,
		isSaving,
		profileId,
		saveFileContent,
		setFileDirty,
	]);

	saveHandlerRef.current = handleSave;

	useEffect(() => {
		const handleWindowKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.key.toLowerCase() !== "s") return;
			if (!event.metaKey && !event.ctrlKey) return;

			const pane = paneRef.current;
			if (!pane || pane.getClientRects().length === 0) return;

			event.preventDefault();
			saveHandlerRef.current();
		};

		window.addEventListener("keydown", handleWindowKeyDown);
		return () => window.removeEventListener("keydown", handleWindowKeyDown);
	}, []);

	const handleEditorMount = useCallback<OnMount>((editor, monaco) => {
		editor.addCommand(
			monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
			() => saveHandlerRef.current(),
		);
	}, []);

	if (isLoading && !hasLoadedFile) {
		return (
			<Flex align="center" justify="center" h="32">
				<Spinner size="sm" />
			</Flex>
		);
	}

	if (error && !hasLoadedFile) {
		return (
			<Flex align="center" justify="center" h="32" px="6">
				<Text color="fg.muted" fontSize="sm" textAlign="center">
					{error instanceof Error ? error.message : String(error)}
				</Text>
			</Flex>
		);
	}

	if (!hasLoadedFile) return null;

	return (
		<Box ref={paneRef} h="full" minH="0" overflow="hidden">
			<Editor
				height="100%"
				path={filePath}
				language={language}
				theme={monacoTheme}
				value={editorValue}
				options={editorOptions}
				beforeMount={handleEditorBeforeMount}
				onChange={handleEditorChange}
				onMount={handleEditorMount}
				loading={(
					<Flex align="center" justify="center" h="full">
						<Spinner size="sm" />
					</Flex>
				)}
			/>
		</Box>
	);
}
