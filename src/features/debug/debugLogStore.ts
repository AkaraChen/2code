import { create } from "zustand";
import type { LogEntry } from "@/generated/types";

const MAX_LOGS = 1000;
const FLUSH_INTERVAL_MS = 100;

export interface DebugLogEntry extends LogEntry {
	id: number;
}

interface DebugLogStore {
	logs: DebugLogEntry[];
	addLog: (entry: LogEntry) => void;
	addLogs: (entries: LogEntry[]) => void;
	clear: () => void;
}

let nextId = 0;
const pendingBuffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingDebugLogs() {
	pendingBuffer.length = 0;
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
}

export const useDebugLogStore = create<DebugLogStore>()((set) => ({
	logs: [],
	addLogs: (entries) => {
		if (entries.length === 0) return;
		set((state) => {
			const stamped = entries.map((entry) => ({ ...entry, id: nextId++ }));
			const merged = state.logs.concat(stamped);
			return {
				logs:
					merged.length > MAX_LOGS
						? merged.slice(-MAX_LOGS)
						: merged,
			};
		});
	},
	addLog: (entry) => useDebugLogStore.getState().addLogs([entry]),
	clear: () => {
		clearPendingDebugLogs();
		set({ logs: [] });
	},
}));

export function enqueueDebugLog(entry: LogEntry) {
	pendingBuffer.push(entry);
	if (pendingBuffer.length > MAX_LOGS) {
		pendingBuffer.splice(0, pendingBuffer.length - MAX_LOGS);
	}
	if (flushTimer === null) {
		flushTimer = setTimeout(flushDebugLogs, FLUSH_INTERVAL_MS);
	}
}

export function flushDebugLogs() {
	if (flushTimer !== null) {
		clearTimeout(flushTimer);
		flushTimer = null;
	}
	if (pendingBuffer.length === 0) return;
	const batch = pendingBuffer.splice(0, pendingBuffer.length);
	useDebugLogStore.getState().addLogs(batch);
}
