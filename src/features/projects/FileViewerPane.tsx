import "@/shared/lib/monaco";
import {
	Box,
	Flex,
	Spinner,
	Text,
} from "@chakra-ui/react";
import Editor from "@monaco-editor/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type {
	BeforeMount,
	EditorProps,
	OnChange,
	OnMount,
} from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownEditor from "@/features/markdown/MarkdownEditor";
import ArchivePreviewTree from "@/features/projects/ArchivePreviewTree";
import { isPreviewableBinaryFile } from "@/features/projects/filePreview";
import { useFileViewerDirtyStore } from "@/features/projects/fileViewerTabsStore";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { FilePreview } from "@/generated";
import { detectMonacoLanguage } from "@/shared/lib/languageDetection";
import { useFileContent, useFilePreview, useSaveFileContent } from "./hooks";

interface FileViewerPaneProps {
	filePath: string;
	profileId: string;
}

const DRAFT_SYNC_DELAY_MS = 400;

interface PendingDraft {
	profileId: string;
	filePath: string;
	content: string;
}

function isDraftForFile(
	draft: PendingDraft | null,
	profileId: string,
	filePath: string,
): draft is PendingDraft {
	return draft?.profileId === profileId && draft.filePath === filePath;
}

function getMonacoTheme(themeId: string) {
	return themeId.includes("light") ? "light" : "vs-dark";
}

function isMarkdownFile(filePath: string) {
	return /\.(?:md|mdx)$/i.test(filePath);
}

function useFilePreviewAssetUrl(preview: FilePreview | undefined) {
	return useMemo(() => {
		if (!preview) return null;

		const baseUrl = convertFileSrc(preview.file_path);
		const separator = baseUrl.includes("?") ? "&" : "?";

		return `${baseUrl}${separator}v=${encodeURIComponent(preview.file_path)}`;
	}, [preview]);
}

function FilePreviewPane({
	error,
	filePath,
	isError,
	isLoading,
	preview,
}: {
	error: unknown;
	filePath: string;
	isError: boolean;
	isLoading: boolean;
	preview: FilePreview | undefined;
}) {
	const assetUrl = useFilePreviewAssetUrl(preview);
	const filename = filePath.split("/").pop() ?? filePath;
	const isImage = preview?.kind === "image";
	const isArchive = preview?.kind === "archive";
	const isPdf = preview?.mime_type === "application/pdf";

	if (isArchive && preview?.archive_entries) {
		return (
			<ArchivePreviewTree
				entries={preview.archive_entries}
				fileName={filename}
			/>
		);
	}

	return (
		<Flex h="full" minH="0" direction="column" overflow="hidden" bg="bg.panel">
			<Flex
				align="center"
				justify="space-between"
				gap="3"
				minH="9"
				px="3"
				borderBottomWidth="1px"
				borderColor="border.subtle"
				bg="bg.subtle"
			>
				<Text fontSize="sm" fontWeight="medium" truncate>
					{filename}
				</Text>
				<Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
					{preview?.kind === "office-pdf" ? "Office Preview" : "Preview"}
				</Text>
			</Flex>

			<Flex flex="1" minH="0" align="center" justify="center" overflow="auto">
				{isLoading ? (
					<Spinner size="sm" />
				) : isError ? (
					<Text maxW="lg" px="6" color="fg.muted" fontSize="sm" textAlign="center">
						{error instanceof Error ? error.message : String(error)}
					</Text>
				) : assetUrl && isImage ? (
					<Box
						w="full"
						h="full"
						p="4"
						display="flex"
						alignItems="center"
						justifyContent="center"
						bgImage={[
							"linear-gradient(45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
							"linear-gradient(-45deg, rgba(127, 127, 127, 0.08) 25%, transparent 25%)",
							"linear-gradient(45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
							"linear-gradient(-45deg, transparent 75%, rgba(127, 127, 127, 0.08) 75%)",
						].join(", ")}
						bgSize="16px 16px"
						css={{ backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0" }}
					>
						<img
							src={assetUrl}
							alt={filename}
							style={{
								maxWidth: "100%",
								maxHeight: "100%",
								objectFit: "contain",
							}}
						/>
					</Box>
				) : assetUrl && isPdf ? (
					<iframe
						src={assetUrl}
						title={filename}
						style={{
							width: "100%",
							height: "100%",
							border: 0,
							background: "white",
						}}
					/>
				) : (
					<Text color="fg.muted" fontSize="sm">
						Preview unavailable
					</Text>
				)}
			</Flex>
		</Flex>
	);
}

export default function FileViewerPane({
	filePath,
	profileId,
}: FileViewerPaneProps) {
	const themeId = useTerminalThemeId();
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const paneRef = useRef<HTMLDivElement | null>(null);
	const saveHandlerRef = useRef<() => void>(() => {});
	const pendingDraftRef = useRef<PendingDraft | null>(null);
	const draftSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const [localEditorValue, setLocalEditorValue] = useState<PendingDraft | null>(
		null,
	);
	const draftValue = useFileViewerDirtyStore(
		(state) => state.drafts[profileId]?.[filePath],
	);
	const savedValue = useFileViewerDirtyStore(
		(state) => state.savedValues[profileId]?.[filePath],
	);
	const setFileDraft = useFileViewerDirtyStore((state) => state.setFileDraft);
	const setFileSavedValue = useFileViewerDirtyStore(
		(state) => state.setFileSavedValue,
	);
	const setFileDirty = useFileViewerDirtyStore((state) => state.setFileDirty);

	const fileMeta = useMemo(
		() => {
			const filename = filePath.split("/").pop() ?? "";
			return {
				filename,
				language: detectMonacoLanguage(filename),
				markdownFile: isMarkdownFile(filePath),
				previewableBinaryFile: isPreviewableBinaryFile(filePath),
			};
		},
		[filePath],
	);
	const {
		data: content,
		error,
		isError,
		isLoading,
	} = useFileContent(profileId, filePath, !fileMeta.previewableBinaryFile);
	const previewQuery = useFilePreview(profileId, filePath, fileMeta.previewableBinaryFile);
	const {
		isPending: isSaving,
		mutate: saveFileContent,
	} = useSaveFileContent(profileId);

	const monacoTheme = getMonacoTheme(themeId);
	const localEditorValueMatchesFile = isDraftForFile(
		localEditorValue,
		profileId,
		filePath,
	);
	if (localEditorValue && !localEditorValueMatchesFile) {
		setLocalEditorValue(null);
	}
	const currentLocalEditorValue = localEditorValueMatchesFile
		? localEditorValue.content
		: undefined;
	const editorValue = currentLocalEditorValue ?? draftValue ?? content ?? "";
	const lastSavedValue = savedValue ?? content ?? "";
	const hasLoadedFile =
		content != null || draftValue != null || currentLocalEditorValue != null;
	const hasUnsavedChanges = editorValue !== lastSavedValue;

	const flushPendingDraft = useCallback(() => {
		if (draftSyncTimerRef.current) {
			clearTimeout(draftSyncTimerRef.current);
			draftSyncTimerRef.current = null;
		}

		const pendingDraft = pendingDraftRef.current;
		if (!pendingDraft) return;
		pendingDraftRef.current = null;

		const currentDraft =
			useFileViewerDirtyStore.getState().drafts[pendingDraft.profileId]?.[
				pendingDraft.filePath
			];
		if (currentDraft === pendingDraft.content) return;

		setFileDraft(
			pendingDraft.profileId,
			pendingDraft.filePath,
			pendingDraft.content,
		);
	}, [setFileDraft]);

	useEffect(() => {
		flushPendingDraft();
	}, [filePath, flushPendingDraft, profileId]);

	useEffect(() => {
		return () => {
			flushPendingDraft();
		};
	}, [flushPendingDraft]);

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

	const handleFileChange = useCallback(
		(nextValue: string) => {
			setLocalEditorValue({
				profileId,
				filePath,
				content: nextValue,
			});
			pendingDraftRef.current = {
				profileId,
				filePath,
				content: nextValue,
			};
			if (draftSyncTimerRef.current) {
				clearTimeout(draftSyncTimerRef.current);
			}
			draftSyncTimerRef.current = setTimeout(() => {
				flushPendingDraft();
			}, DRAFT_SYNC_DELAY_MS);
		},
		[filePath, flushPendingDraft, profileId],
	);

	const handleEditorChange = useCallback<OnChange>(
		(nextValue) => {
			handleFileChange(nextValue ?? "");
		},
		[handleFileChange],
	);

	const handleSave = useCallback((contentOverride?: string) => {
		const contentToSave = contentOverride ?? editorValue;
		if (!hasLoadedFile || contentToSave === lastSavedValue || isSaving) return;

		flushPendingDraft();
		saveFileContent(
			{ path: filePath, content: contentToSave },
			{
				onSuccess: (_result, variables) => {
					setFileDraft(profileId, variables.path, variables.content);
					setFileSavedValue(profileId, variables.path, variables.content);
					setFileDirty(profileId, variables.path, false);
				},
			},
		);
	}, [
		editorValue,
		filePath,
		flushPendingDraft,
		hasLoadedFile,
		isSaving,
		lastSavedValue,
		profileId,
		saveFileContent,
		setFileDraft,
		setFileDirty,
		setFileSavedValue,
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

	if (fileMeta.previewableBinaryFile) {
		return (
			<Box ref={paneRef} h="full" minH="0" overflow="hidden">
				<FilePreviewPane
					filePath={filePath}
					preview={previewQuery.data}
					error={previewQuery.error}
					isError={previewQuery.isError}
					isLoading={previewQuery.isLoading}
				/>
			</Box>
		);
	}

	if (isLoading && !hasLoadedFile) {
		return (
			<Flex align="center" justify="center" h="32">
				<Spinner size="sm" />
			</Flex>
		);
	}

	if (isError && !hasLoadedFile) {
		return (
			<Flex align="center" justify="center" h="32" px="6">
				<Text color="fg.muted" fontSize="sm" textAlign="center">
					{error instanceof Error ? error.message : String(error)}
				</Text>
			</Flex>
		);
	}

	if (!hasLoadedFile) return null;

	if (fileMeta.markdownFile) {
		return (
			<Box ref={paneRef} h="full" minH="0" overflow="hidden">
				<MarkdownEditor
					editorKey={filePath}
					initialMarkdown={editorValue}
					onMarkdownChange={handleFileChange}
					onRequestSave={handleSave}
					saveStatus={isSaving ? "saving" : "idle"}
				/>
			</Box>
		);
	}

	return (
		<Box ref={paneRef} h="full" minH="0" overflow="hidden">
			<Editor
				height="100%"
				path={filePath}
				language={fileMeta.language}
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
