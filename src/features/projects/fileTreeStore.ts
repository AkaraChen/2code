import { create } from "zustand";

interface FileTreeState {
	openProfiles: Record<string, boolean>;
	toggle: (profileId: string) => void;
	isOpen: (profileId: string) => boolean;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
	openProfiles: {},
	toggle: (profileId) =>
		set((state) => ({
			openProfiles: {
				...state.openProfiles,
				[profileId]: !(state.openProfiles[profileId] ?? true),
			},
		})),
	isOpen: (profileId) => get().openProfiles[profileId] ?? true,
}));
