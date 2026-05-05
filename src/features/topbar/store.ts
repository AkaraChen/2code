import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ControlId } from "./types";

export const defaultActiveControls: ControlId[] = [
	"github-desktop",
	"vscode",
	"git-diff",
	"pr-status",
	"reveal-in-finder",
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

interface PersistedTopBarState {
	activeControls?: ControlId[];
	controlOptions?: Record<string, Record<string, unknown>>;
}

function withPrStatusControl(controls: ControlId[]) {
	if (controls.includes("pr-status")) return controls;

	const gitDiffIndex = controls.indexOf("git-diff");
	if (gitDiffIndex === -1) return [...controls, "pr-status"];

	return [
		...controls.slice(0, gitDiffIndex + 1),
		"pr-status",
		...controls.slice(gitDiffIndex + 1),
	];
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
		{
			name: "topbar-settings",
			version: 2,
			migrate: (persistedState, version) => {
				if (version >= 2 || !persistedState) return persistedState;

				const state = persistedState as PersistedTopBarState;
				return {
					...state,
					activeControls: withPrStatusControl(
						state.activeControls ?? defaultActiveControls,
					),
				};
			},
		},
	),
);
