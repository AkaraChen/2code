import { create } from "zustand";
import type { LogEntry } from "@/generated/types";

const MAX_LOGS = 1000;

interface DebugLogStore {
	logs: LogEntry[];
	addLog: (entry: LogEntry) => void;
	clear: () => void;
}

export const useDebugLogStore = create<DebugLogStore>()((set) => ({
	logs: [],
	addLog: (entry) =>
		set((state) => {
			const logs = [...state.logs, entry];
			if (logs.length > MAX_LOGS) {
				logs.splice(0, logs.length - MAX_LOGS);
			}
			return { logs };
		}),
	clear: () => set({ logs: [] }),
}));
