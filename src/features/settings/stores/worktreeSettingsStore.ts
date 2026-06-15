import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorktreeSettingsStore {
	defaultWorktreeDir: string;
	setDefaultWorktreeDir: (path: string) => void;
	clearDefaultWorktreeDir: () => void;
}

type PersistedWorktreeSettings = Pick<
	WorktreeSettingsStore,
	"defaultWorktreeDir"
>;

function normalizeWorktreeDir(path: string) {
	return path.trim();
}

function migrateWorktreeSettings(
	persistedState: unknown,
): PersistedWorktreeSettings {
	const state = persistedState as Partial<PersistedWorktreeSettings>;
	const defaultWorktreeDir =
		typeof state.defaultWorktreeDir === "string"
			? normalizeWorktreeDir(state.defaultWorktreeDir)
			: "";

	return { defaultWorktreeDir };
}

export const useWorktreeSettingsStore = create<WorktreeSettingsStore>()(
	persist<WorktreeSettingsStore, [], [], PersistedWorktreeSettings>(
		(set) => ({
			defaultWorktreeDir: "",
			setDefaultWorktreeDir: (path) =>
				set({ defaultWorktreeDir: normalizeWorktreeDir(path) }),
			clearDefaultWorktreeDir: () => set({ defaultWorktreeDir: "" }),
		}),
		{
			name: "worktree-settings",
			partialize: (state) => ({
				defaultWorktreeDir: state.defaultWorktreeDir,
			}),
			version: 1,
			migrate: migrateWorktreeSettings,
		},
	),
);
