import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStorage } from "@/shared/lib/tauriStorage";
import type { GlobalTerminalTemplate } from "@/features/terminal/templates";

interface TerminalTemplatesStore {
	templates: GlobalTerminalTemplate[];
	setTemplates: (templates: GlobalTerminalTemplate[]) => void;
}

interface PersistedTerminalTemplatesState {
	templates?: unknown;
}

export function migrateTerminalTemplatesState(
	state: PersistedTerminalTemplatesState | undefined,
): Pick<TerminalTemplatesStore, "templates"> {
	if (!state || !Array.isArray(state.templates)) {
		return { templates: [] };
	}

	return {
		templates: state.templates.filter(
			(template): template is GlobalTerminalTemplate =>
				!!template &&
				typeof template === "object" &&
				"id" in template &&
				"name" in template &&
				"commands" in template,
		),
	};
}

export const useTerminalTemplatesStore = create<TerminalTemplatesStore>()(
	persist(
		(set) => ({
			templates: [],
			setTemplates: (templates) => set({ templates }),
		}),
		{
			name: "terminal-template-settings",
			version: 1,
			storage: createJSONStorage(() => tauriStorage),
			migrate: (state) =>
				migrateTerminalTemplatesState(
					state as PersistedTerminalTemplatesState | undefined,
				),
		},
	),
);
