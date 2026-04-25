import { useCallback, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import {
	useFileViewerDirtyStore,
	useFileViewerTabsStore,
} from "./fileViewerTabsStore";
import {
	dispatchNewFileCancel,
	useFileDraftStore,
	useNewFileSessionStore,
} from "./untitledDrafts";
import UnsavedFileDialog, {
	type UnsavedFileChoice,
} from "./UnsavedFileDialog";
import { useSaveFileTab } from "./useSaveFileTab";

interface PromptRequest {
	profileId: string;
	filePath: string;
	fileName: string;
	isUntitled: boolean;
	resolve: (choice: UnsavedFileChoice) => void;
}

interface PromptStore {
	current: PromptRequest | null;
	open: (request: PromptRequest) => void;
	resolve: (choice: UnsavedFileChoice) => void;
}

const usePromptStore = create<PromptStore>((set, get) => ({
	current: null,
	open(request) {
		set({ current: request });
	},
	resolve(choice) {
		const current = get().current;
		if (!current) return;
		set({ current: null });
		current.resolve(choice);
	},
}));

function isDirtyTab(profileId: string, filePath: string) {
	return (
		useFileViewerDirtyStore
			.getState()
			.profiles[profileId]?.includes(filePath) ?? false
	);
}

function isUntitledTabWithBuffer(filePath: string) {
	const draft = useFileDraftStore.getState().drafts[filePath];
	return draft != null && draft.length > 0;
}

/**
 * Close a file tab safely. If the tab has unsaved edits, prompt the user
 * with Save / Don't save / Cancel. Returns true when the tab was actually
 * closed, false when the user cancelled (or save failed).
 *
 * Untitled tabs are only treated as dirty when they have non-empty buffer
 * content — closing an untouched blank scratch tab does not trigger the
 * prompt.
 */
export function useCloseFileTabFlow(profileId: string) {
	const closeTab = useFileViewerTabsStore((state) => state.closeTab);
	const saveFileTab = useSaveFileTab(profileId);

	return useCallback(
		async (filePath: string): Promise<boolean> => {
			const dirty =
				isDirtyTab(profileId, filePath)
				|| isUntitledTabWithBuffer(filePath);
			if (!dirty) {
				closeTab(profileId, filePath);
				cleanupDraftFor(filePath);
				cancelLinkedNewFileSession(filePath);
				return true;
			}

			const tab = useFileViewerTabsStore
				.getState()
				.profiles[profileId]?.tabs.find(
					(t) => t.filePath === filePath,
				);
			const fileName = tab?.title ?? filePath.split("/").pop() ?? filePath;
			const isUntitled = filePath.startsWith("untitled://");

			const choice = await new Promise<UnsavedFileChoice>((resolve) => {
				usePromptStore.getState().open({
					profileId,
					filePath,
					fileName,
					isUntitled,
					resolve,
				});
			});

			if (choice === "cancel") return false;

			if (choice === "save") {
				const result = await saveFileTab(filePath);
				if (result.kind === "cancelled" || result.kind === "error") {
					// Save was aborted (e.g. user dismissed the save-as
					// picker) — keep the tab open so they don't lose work.
					return false;
				}
				const finalPath =
					result.kind === "saved" ? result.finalPath : filePath;
				// Successful save-as already cancels the linked rename
				// session via `cancelByUntitledPath` inside saveFileTab.
				closeTab(profileId, finalPath);
				cleanupDraftFor(finalPath);
				return true;
			}

			// "discard"
			closeTab(profileId, filePath);
			cleanupDraftFor(filePath);
			cancelLinkedNewFileSession(filePath);
			return true;
		},
		[closeTab, profileId, saveFileTab],
	);
}

function cleanupDraftFor(filePath: string) {
	useFileDraftStore.getState().clearForPath(filePath);
}

/**
 * If the closed tab was an untitled draft tied to an in-progress New File
 * rename in the tree, tell the panel to cancel that rename (and remove the
 * placeholder). Without this the tree placeholder lingers and the rename
 * input stays open, even though the editor tab driving it is gone.
 */
function cancelLinkedNewFileSession(filePath: string) {
	const placeholderPath = useNewFileSessionStore
		.getState()
		.findPlaceholderByUntitledPath(filePath);
	if (placeholderPath) dispatchNewFileCancel(placeholderPath);
}

/**
 * Renders the unsaved-changes dialog driven by `useCloseFileTabFlow`.
 * Mount once at app shell level — multiple instances would race each other.
 *
 * The Dialog stays mounted across opens/closes so Chakra can run its own
 * mount/unmount-side-effect cleanup (focus trap, inert background, body
 * scroll lock) cleanly. We just toggle `isOpen` and remember the most
 * recent request so the dialog has a title to render while animating out.
 */
export function UnsavedFileDialogHost() {
	const current = usePromptStore((state) => state.current);
	const resolve = usePromptStore((state) => state.resolve);
	const [view, setView] = useState<{
		fileName: string;
		isUntitled: boolean;
	} | null>(null);
	const resolverRef = useRef<typeof resolve>(resolve);
	resolverRef.current = resolve;

	useEffect(() => {
		if (current) {
			setView({
				fileName: current.fileName,
				isUntitled: current.isUntitled,
			});
		}
	}, [current]);

	const handleClose = useCallback((choice: UnsavedFileChoice) => {
		resolverRef.current(choice);
	}, []);

	return (
		<UnsavedFileDialog
			isOpen={current != null}
			fileName={view?.fileName ?? ""}
			isUntitled={view?.isUntitled ?? false}
			onClose={handleClose}
		/>
	);
}
