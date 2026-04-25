import { create } from "zustand";

const UNTITLED_SCHEME = "untitled://";

interface FileDraftStore {
	drafts: Record<string, string>;
	savedValues: Record<string, string>;
	setDraft: (filePath: string, content: string) => void;
	setSavedValue: (filePath: string, content: string) => void;
	rename: (oldFilePath: string, newFilePath: string) => void;
	clearForPath: (filePath: string) => void;
}

export const useFileDraftStore = create<FileDraftStore>((set) => ({
	drafts: {},
	savedValues: {},
	setDraft(filePath, content) {
		set((state) => ({
			drafts: { ...state.drafts, [filePath]: content },
		}));
	},
	setSavedValue(filePath, content) {
		set((state) => ({
			savedValues: { ...state.savedValues, [filePath]: content },
		}));
	},
	rename(oldFilePath, newFilePath) {
		if (oldFilePath === newFilePath) return;
		set((state) => {
			const drafts = { ...state.drafts };
			const savedValues = { ...state.savedValues };
			if (oldFilePath in drafts) {
				drafts[newFilePath] = drafts[oldFilePath];
				delete drafts[oldFilePath];
			}
			if (oldFilePath in savedValues) {
				savedValues[newFilePath] = savedValues[oldFilePath];
				delete savedValues[oldFilePath];
			}
			return { drafts, savedValues };
		});
	},
	clearForPath(filePath) {
		set((state) => {
			const drafts = { ...state.drafts };
			const savedValues = { ...state.savedValues };
			delete drafts[filePath];
			delete savedValues[filePath];
			return { drafts, savedValues };
		});
	},
}));

let counter = 0;

function nextDraftId() {
	counter += 1;
	return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function buildUntitledFilePath(draftId: string) {
	return `${UNTITLED_SCHEME}${draftId}`;
}

export function isUntitledFilePath(filePath: string) {
	return filePath.startsWith(UNTITLED_SCHEME);
}

export function mintUntitledFilePath() {
	return buildUntitledFilePath(nextDraftId());
}

/**
 * When the file tree's "New File" flow opens an untitled tab and starts an
 * inline rename, we need to remember which placeholder path corresponds to
 * which open untitled tab so that committing the rename re-keys the same tab
 * (rather than opening a second one).
 */
interface NewFileSessionStore {
	pending: Record<string, { profileId: string; untitledPath: string }>;
	register: (
		placeholderPath: string,
		profileId: string,
		untitledPath: string,
	) => void;
	consume: (
		placeholderPath: string,
	) => { profileId: string; untitledPath: string } | null;
	cancelByUntitledPath: (untitledPath: string) => void;
	findPlaceholderByUntitledPath: (untitledPath: string) => string | null;
}

export const useNewFileSessionStore = create<NewFileSessionStore>((set, get) => ({
	pending: {},
	register(placeholderPath, profileId, untitledPath) {
		set((state) => ({
			pending: {
				...state.pending,
				[placeholderPath]: { profileId, untitledPath },
			},
		}));
	},
	consume(placeholderPath) {
		const entry = get().pending[placeholderPath];
		if (!entry) return null;
		set((state) => {
			const next = { ...state.pending };
			delete next[placeholderPath];
			return { pending: next };
		});
		return entry;
	},
	cancelByUntitledPath(untitledPath) {
		const { pending } = get();
		const entry = Object.entries(pending).find(
			([, value]) => value.untitledPath === untitledPath,
		);
		if (!entry) return;
		set((state) => {
			const next = { ...state.pending };
			delete next[entry[0]];
			return { pending: next };
		});
	},
	findPlaceholderByUntitledPath(untitledPath) {
		const entry = Object.entries(get().pending).find(
			([, value]) => value.untitledPath === untitledPath,
		);
		return entry ? entry[0] : null;
	},
}));

/**
 * Custom event the close-tab flow dispatches when an untitled tab tied to
 * an in-progress New File rename is being closed. The file tree panel
 * listens for this and removes the placeholder + cancels its rename input.
 */
export const NEW_FILE_CANCEL_EVENT = "2code:cancel-new-file-session";

export interface NewFileCancelDetail {
	placeholderPath: string;
}

export function dispatchNewFileCancel(placeholderPath: string) {
	window.dispatchEvent(
		new CustomEvent<NewFileCancelDetail>(NEW_FILE_CANCEL_EVENT, {
			detail: { placeholderPath },
		}),
	);
}
