import { create } from "zustand";
import { persist } from "zustand/middleware";

export const FILE_TREE_PANEL_MIN_WIDTH = 180;
export const FILE_TREE_PANEL_MAX_WIDTH = 560;
export const DEFAULT_FILE_TREE_PANEL_WIDTH = 208;

export function clampFileTreePanelWidth(width: number) {
	return Math.min(
		FILE_TREE_PANEL_MAX_WIDTH,
		Math.max(FILE_TREE_PANEL_MIN_WIDTH, width),
	);
}

interface FileTreeState {
	openProfiles: Record<string, boolean>;
	panelWidth: number;
	toggle: (profileId: string) => void;
	isOpen: (profileId: string) => boolean;
	setPanelWidth: (width: number) => void;
}

export const useFileTreeStore = create<FileTreeState>()(
	persist(
		(set, get) => ({
			openProfiles: {},
			panelWidth: DEFAULT_FILE_TREE_PANEL_WIDTH,
			toggle: (profileId) =>
				set((state) => ({
					openProfiles: {
						...state.openProfiles,
						[profileId]: !(state.openProfiles[profileId] ?? true),
					},
				})),
			isOpen: (profileId) => get().openProfiles[profileId] ?? true,
			setPanelWidth: (width) =>
				set({ panelWidth: clampFileTreePanelWidth(width) }),
		}),
		{
			name: "file-tree-panel",
			version: 1,
			partialize: (state) => ({ panelWidth: state.panelWidth }),
		},
	),
);
