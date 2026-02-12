import { create } from "zustand";
import type { LogEntry } from "@/generated/types";

const MAX_LOGS = 1000;

interface DebugLogStore {
	logs: LogEntry[];
	addLog: (entry: LogEntry) => void;
	clear: () => void;
}

export const useDebugLogStore = create<DebugLogStore>((set) => ({
	logs: [],
	addLog: (entry) =>
		set((state) => {
			const next = [...state.logs, entry];
			if (next.length > MAX_LOGS) {
				return { logs: next.slice(next.length - MAX_LOGS) };
			}
			return { logs: next };
		}),
	clear: () => set({ logs: [] }),
}));
