import { produce } from "immer";
import { bench, describe } from "vitest";
import type { LogEntry } from "@/generated/types";
import { appendDebugLog } from "./debugLogStore";

const MAX_LOGS = 1000;

function appendDebugLogWithImmer(logs: LogEntry[], entry: LogEntry) {
	return produce(logs, (draft) => {
		draft.push(entry);
		if (draft.length > MAX_LOGS) {
			draft.splice(0, draft.length - MAX_LOGS);
		}
	});
}

const entries = Array.from({ length: 2_000 }, (_, index) => ({
	timestamp: index,
	level: "INFO",
	source: "bench",
	message: `log ${index}`,
})) satisfies LogEntry[];

describe("appendDebugLog", () => {
	bench("immer push and splice", () => {
		let logs: LogEntry[] = [];
		for (const entry of entries) {
			logs = appendDebugLogWithImmer(logs, entry);
		}
	});

	bench("manual bounded append", () => {
		let logs: LogEntry[] = [];
		for (const entry of entries) {
			logs = appendDebugLog(logs, entry);
		}
	});
});
