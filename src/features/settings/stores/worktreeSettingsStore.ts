import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WorktreeSettingsStore {
	defaultWorktreeDir: string;
	setDefaultWorktreeDir: (path: string) => void;
	clearDefaultWorktreeDir: () => void;
}

function normalizeWorktreeDir(path: string) {
	return path.trim();
}

export const useWorktreeSettingsStore = create<WorktreeSettingsStore>()(
	persist(
		(set) => ({
			defaultWorktreeDir: "",
			setDefaultWorktreeDir: (path) =>
				set({ defaultWorktreeDir: normalizeWorktreeDir(path) }),
			clearDefaultWorktreeDir: () => set({ defaultWorktreeDir: "" }),
		}),
		{ name: "worktree-settings" },
	),
);
