import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { LogEntry } from "@/generated/types";

const MAX_LOGS = 1000;

interface DebugLogStore {
	logs: LogEntry[];
	addLog: (entry: LogEntry) => void;
	clear: () => void;
}

export const useDebugLogStore = create<DebugLogStore>()(
	immer((set) => ({
		logs: [],
		addLog: (entry) =>
			set((state) => {
				state.logs.push(entry);
				if (state.logs.length > MAX_LOGS) {
					state.logs.splice(0, state.logs.length - MAX_LOGS);
				}
			}),
		clear: () => set({ logs: [] }),
	})),
);
