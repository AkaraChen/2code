import { create } from "zustand";

interface FileCandidate {
	name: string;
	path: string;
	relative_path: string;
}

interface FileLinkPickerState {
	isOpen: boolean;
	profileId: string | null;
	candidates: FileCandidate[];
	show: (profileId: string, candidates: FileCandidate[]) => void;
	close: () => void;
}

export const useFileLinkPickerStore = create<FileLinkPickerState>((set) => ({
	isOpen: false,
	profileId: null,
	candidates: [],
	show(profileId, candidates) {
		set({ isOpen: true, profileId, candidates });
	},
	close() {
		set({ isOpen: false, profileId: null, candidates: [] });
	},
}));
