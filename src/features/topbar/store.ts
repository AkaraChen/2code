import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ControlId } from "./types";

export const defaultActiveControls: ControlId[] = [
	"github-desktop",
	"vscode",
	"github-pr",
	"git-diff",
];

interface TopBarStore {
	activeControls: ControlId[];
	setActiveControls: (controls: ControlId[]) => void;
	resetToDefaults: () => void;
}

export const useTopBarStore = create<TopBarStore>()(
	persist(
		(set) => ({
			activeControls: [...defaultActiveControls],
			setActiveControls: (controls) => set({ activeControls: controls }),
			resetToDefaults: () =>
				set({
					activeControls: [...defaultActiveControls],
				}),
		}),
		{ name: "topbar-settings", version: 3 },
	),
);
