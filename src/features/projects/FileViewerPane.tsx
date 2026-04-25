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
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "@/features/projects/fileViewerTabsStore";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import { detectMonacoLanguage } from "@/shared/lib/languageDetection";
import { useFileContent, useSaveFileContent } from "./hooks";
import {
	isUntitledFilePath,
	useFileDraftStore,
} from "./untitledDrafts";
import { useSaveFileTab } from "./useSaveFileTab";

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
	const draftsByPath = useFileDraftStore((s) => s.drafts);
	const savedValuesByPath = useFileDraftStore((s) => s.savedValues);
	const setDraft = useFileDraftStore((s) => s.setDraft);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const saveHandlerRef = useRef<() => void>(() => {});
	const setFileDirty = useFileViewerDirtyStore((state) => state.setFileDirty);

	const isUntitled = isUntitledFilePath(filePath);
	const { data: content, isLoading, error } = useFileContent(
		filePath,
		!isUntitled,
	);
	const { isPending: isSaving } = useSaveFileContent(profileId);
	const saveFileTab = useSaveFileTab(profileId);

	const tabs = useFileViewerTabsStore(
		(state) => state.profiles[profileId]?.tabs,
	);
	const tabTitle = useMemo(
		() => tabs?.find((t) => t.filePath === filePath)?.title,
		[filePath, tabs],
	);
	const filename = isUntitled
		? (tabTitle ?? "untitled")
		: (filePath.split("/").pop() ?? "");
	const language = detectMonacoLanguage(filename);
	const monacoTheme = getMonacoTheme(themeId);
	const draftValue = draftsByPath[filePath];
	const savedValue = savedValuesByPath[filePath];
	const editorValue = isUntitled
		? (draftValue ?? "")
		: (draftValue ?? content ?? "");
	const lastSavedValue = isUntitled
		? (savedValue ?? "")
		: (savedValue ?? content ?? "");
	const hasLoadedFile = isUntitled || content != null || draftValue != null;
	const hasUnsavedChanges = isUntitled
		? editorValue.length > 0 && editorValue !== lastSavedValue
		: editorValue !== lastSavedValue;

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
			setDraft(filePath, nextValue ?? "");
		},
		[filePath, setDraft],
	);

	const handleSave = useCallback(async () => {
		if (!hasLoadedFile || isSaving) return;
		await saveFileTab(filePath);
	}, [filePath, hasLoadedFile, isSaving, saveFileTab]);

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
