import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ControlId } from "./types";

export const defaultActiveControls: ControlId[] = [
	"github-desktop",
	"vscode",
	"pr-status",
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
	// Persisted lists may contain retired ids (e.g. "git-diff"), so keep
	// migration inputs as plain strings.
	activeControls?: string[];
	controlOptions?: Record<string, Record<string, unknown>>;
}

function withPrStatusControl(controls: string[]) {
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
			version: 4,
			migrate: (persistedState, version) => {
				if (version >= 4 || !persistedState) return persistedState;

				const state = persistedState as PersistedTopBarState;
				let controls = state.activeControls ?? [...defaultActiveControls];
				if (version < 2) {
					controls = withPrStatusControl(controls);
				}
				// v3: git-diff moved into the sidebar git panel;
				// v4: reveal-in-finder replaced by clicking the project name
				controls = controls.filter(
					(id) => id !== "git-diff" && id !== "reveal-in-finder",
				);
				return {
					...state,
					activeControls: controls as ControlId[],
				};
			},
		},
	),
);
