import { bench, describe } from "vitest";

const MAX_LOGS = 1_000;
const entries = Array.from({ length: 100_000 }, (_, timestamp) => ({
	timestamp,
	level: "info",
	source: "bench",
	message: `log ${timestamp}`,
}));

describe("debug log trimming", () => {
	bench("push then trim", () => {
		const logs: typeof entries = [];
		for (const entry of entries) {
			logs.push(entry);
			if (logs.length > MAX_LOGS) {
				logs.splice(0, logs.length - MAX_LOGS);
			}
		}
		if (logs.length !== MAX_LOGS) {
			throw new Error("push-then-trim kept wrong log count");
		}
	});

	bench("trim then push", () => {
		const logs: typeof entries = [];
		for (const entry of entries) {
			if (logs.length >= MAX_LOGS) {
				logs.splice(0, logs.length - MAX_LOGS + 1);
			}
			logs.push(entry);
		}
		if (logs.length !== MAX_LOGS) {
			throw new Error("trim-then-push kept wrong log count");
		}
	});
});
