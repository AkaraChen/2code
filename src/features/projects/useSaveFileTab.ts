import { save as openSaveDialog } from "@tauri-apps/plugin-dialog";
import { useCallback } from "react";
import { toaster } from "@/shared/providers/Toaster";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "./fileViewerTabsStore";
import { useSaveFileContent } from "./hooks";
import {
	dispatchNewFileCancel,
	isUntitledFilePath,
	useFileDraftStore,
	useNewFileSessionStore,
} from "./untitledDrafts";

export type SaveFileTabResult =
	| { kind: "saved"; finalPath: string }
	| { kind: "cancelled" }
	| { kind: "noop" }
	| { kind: "error"; message: string };

/**
 * Persist the current draft buffer for a file tab, opening a save-as dialog
 * for untitled tabs. Shared between Cmd+S in the editor and the
 * close-with-unsaved-changes flow so that both paths produce identical
 * tab/dirty/draft store state.
 */
export function useSaveFileTab(profileId: string) {
	const saveFileContent = useSaveFileContent(profileId);
	const renameTab = useFileViewerTabsStore((state) => state.renameTab);
	const renameDirty = useFileViewerDirtyStore(
		(state) => state.renameDirty,
	);
	const setFileDirty = useFileViewerDirtyStore(
		(state) => state.setFileDirty,
	);
	const cancelNewFileSession = useNewFileSessionStore(
		(state) => state.cancelByUntitledPath,
	);

	return useCallback(
		async (filePath: string): Promise<SaveFileTabResult> => {
			const draftStore = useFileDraftStore.getState();
			const draft = draftStore.drafts[filePath];
			const savedValue = draftStore.savedValues[filePath];
			const isUntitled = isUntitledFilePath(filePath);

			if (isUntitled) {
				const buffer = draft ?? "";
				const tab = useFileViewerTabsStore
					.getState()
					.profiles[profileId]?.tabs.find(
						(t) => t.filePath === filePath,
					);
				const defaultName = tab?.title || "untitled";

				let chosenPath: string | null = null;
				try {
					chosenPath = await openSaveDialog({
						title: "Save as…",
						defaultPath: defaultName,
					});
				} catch (err) {
					const message =
						err instanceof Error ? err.message : String(err);
					toaster.create({
						title: "Save failed",
						description: message,
						type: "error",
						closable: true,
					});
					return { kind: "error", message };
				}
				if (!chosenPath) return { kind: "cancelled" };

				const targetPath = chosenPath;
				try {
					await saveFileContent.mutateAsync({
						path: targetPath,
						content: buffer,
					});
				} catch (err) {
					const message =
						err instanceof Error ? err.message : String(err);
					toaster.create({
						title: "Save failed",
						description: message,
						type: "error",
						closable: true,
					});
					return { kind: "error", message };
				}

				const newTitle = targetPath.split("/").pop() ?? targetPath;
				const linkedPlaceholder = useNewFileSessionStore
					.getState()
					.findPlaceholderByUntitledPath(filePath);
				useFileDraftStore.getState().rename(filePath, targetPath);
				useFileDraftStore
					.getState()
					.setSavedValue(targetPath, buffer);
				renameDirty(profileId, filePath, targetPath);
				renameTab(profileId, filePath, targetPath, newTitle);
				cancelNewFileSession(filePath);
				setFileDirty(profileId, targetPath, false);
				if (linkedPlaceholder) {
					// Tell the file tree to drop the in-progress New File
					// placeholder + its rename input — save-as has just
					// graduated this draft to a real on-disk path that
					// might be entirely different.
					dispatchNewFileCancel(linkedPlaceholder);
				}
				return { kind: "saved", finalPath: targetPath };
			}

			// Real on-disk file. We rely on the dirty flag (driven by the
			// editor pane) to decide whether there's anything to write.
			const isDirty =
				useFileViewerDirtyStore
					.getState()
					.profiles[profileId]?.includes(filePath) ?? false;
			const editorValue = draft ?? savedValue ?? "";
			if (!isDirty || draft == null) {
				return { kind: "noop" };
			}

			try {
				await saveFileContent.mutateAsync({
					path: filePath,
					content: editorValue,
				});
			} catch (err) {
				const message =
					err instanceof Error ? err.message : String(err);
				toaster.create({
					title: "Save failed",
					description: message,
					type: "error",
					closable: true,
				});
				return { kind: "error", message };
			}
			useFileDraftStore.getState().setDraft(filePath, editorValue);
			useFileDraftStore
				.getState()
				.setSavedValue(filePath, editorValue);
			setFileDirty(profileId, filePath, false);
			return { kind: "saved", finalPath: filePath };
		},
		[
			cancelNewFileSession,
			profileId,
			renameDirty,
			renameTab,
			saveFileContent,
			setFileDirty,
		],
	);
}
