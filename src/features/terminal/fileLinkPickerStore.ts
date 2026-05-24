import { create } from "zustand";
import type { FileSearchResult } from "@/generated";

interface FileLinkPickerState {
	isOpen: boolean;
	profileId: string | null;
	candidates: FileSearchResult[];
	show: (profileId: string, candidates: FileSearchResult[]) => void;
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
