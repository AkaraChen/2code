import { create } from "zustand";
import type { LogEntry } from "@/generated/types";

const MAX_LOGS = 1000;

interface DebugLogStore {
	logs: LogEntry[];
	addLog: (entry: LogEntry) => void;
	clear: () => void;
}

export function appendDebugLog(logs: LogEntry[], entry: LogEntry) {
	return logs.length < MAX_LOGS
		? [...logs, entry]
		: [...logs.slice(1), entry];
}

export const useDebugLogStore = create<DebugLogStore>()((set) => ({
	logs: [],
	addLog: (entry) =>
		set((state) => ({
			logs: appendDebugLog(state.logs, entry),
		})),
	clear: () => set({ logs: [] }),
}));
