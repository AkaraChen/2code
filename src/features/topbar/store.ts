import { create } from "zustand";
import { persist } from "zustand/middleware";
import { allControlIds } from "./registry";
import type { ControlId } from "./types";

export const defaultActiveControls: ControlId[] = [
	"open-with",
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
			migrate: (persisted) => {
				const state = (persisted ?? {}) as Partial<TopBarStore>;
				const validIds = new Set<ControlId>(allControlIds);
				const filtered = (state.activeControls ?? []).filter(
					(id): id is ControlId => validIds.has(id as ControlId),
				);
				return {
					...state,
					activeControls:
						filtered.length > 0
							? filtered
							: [...defaultActiveControls],
					controlOptions: state.controlOptions ?? {},
				} as TopBarStore;
			},
		},
	),
);
