import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ControlId } from "./types";

export const defaultActiveControls: ControlId[] = [
	"github-desktop",
	"vscode",
	"git-diff",
];

interface TopBarStore {
	activeControls: ControlId[];
	controlOptions: Record<string, Record<string, unknown>>;
	setActiveControls: (controls: ControlId[]) => void;
	setControlOption: (
		controlId: ControlId,
		key: string,
		value: unknown,
	) => void;
	resetToDefaults: () => void;
}

export const useTopBarStore = create<TopBarStore>()(
	persist(
		(set) => ({
			activeControls: [...defaultActiveControls],
			controlOptions: {},
			setActiveControls: (controls) => set({ activeControls: controls }),
			setControlOption: (controlId, key, value) =>
				set((state) => ({
					controlOptions: {
						...state.controlOptions,
						[controlId]: {
							...state.controlOptions[controlId],
							[key]: value,
						},
					},
				})),
			resetToDefaults: () =>
				set({
					activeControls: [...defaultActiveControls],
					controlOptions: {},
				}),
		}),
		{ name: "topbar-settings", version: 1 },
	),
);
