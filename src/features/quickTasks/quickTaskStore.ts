import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStorage } from "@/shared/lib/tauriStorage";
import type { QuickTask } from "./types";

interface QuickTaskStore {
	tasks: QuickTask[];
	setTasks: (tasks: QuickTask[]) => void;
	upsertTask: (task: QuickTask) => void;
	deleteTask: (taskId: string) => void;
}

interface PersistedQuickTaskState {
	tasks?: unknown;
}

function isQuickTask(value: unknown): value is QuickTask {
	return (
		!!value &&
		typeof value === "object" &&
		"id" in value &&
		"name" in value &&
		"cwd" in value &&
		"command" in value
	);
}

export function migrateQuickTaskState(
	state: PersistedQuickTaskState | undefined,
): Pick<QuickTaskStore, "tasks"> {
	if (!state || !Array.isArray(state.tasks)) {
		return { tasks: [] };
	}

	return {
		tasks: state.tasks.filter(isQuickTask).map((task) => ({
			...task,
			shell:
				typeof task.shell === "string" && task.shell.trim()
					? task.shell
					: "/bin/zsh",
		})),
	};
}

export const useQuickTaskStore = create<QuickTaskStore>()(
	persist(
		(set) => ({
			tasks: [],
			setTasks: (tasks) => set({ tasks }),
			upsertTask: (task) =>
				set((state) => {
					const exists = state.tasks.some(
						(item) => item.id === task.id,
					);
					return {
						tasks: exists
							? state.tasks.map((item) =>
									item.id === task.id ? task : item,
								)
							: [...state.tasks, task],
					};
				}),
			deleteTask: (taskId) =>
				set((state) => ({
					tasks: state.tasks.filter((task) => task.id !== taskId),
				})),
		}),
		{
			name: "quick-task-settings",
			version: 1,
			storage: createJSONStorage(() => tauriStorage),
			migrate: (state) =>
				migrateQuickTaskState(
					state as PersistedQuickTaskState | undefined,
				),
		},
	),
);
