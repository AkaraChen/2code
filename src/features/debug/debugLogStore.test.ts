import { beforeEach, describe, expect, it } from "vitest";
import { useDebugLogStore } from "./debugLogStore";

const makeEntry = (i: number) => ({
	timestamp: i,
	level: "info" as const,
	source: "test",
	message: `log ${i}`,
});

function resetStore() {
	useDebugLogStore.setState({ logs: [] });
}

function getState() {
	return useDebugLogStore.getState();
}

describe("useDebugLogStore", () => {
	beforeEach(resetStore);

	describe("addLog", () => {
		it("appends a log entry", () => {
			getState().addLog(makeEntry(1));
			expect(getState().logs).toHaveLength(1);
			expect(getState().logs[0].message).toBe("log 1");
		});

		it("maintains insertion order", () => {
			getState().addLog(makeEntry(1));
			getState().addLog(makeEntry(2));
			getState().addLog(makeEntry(3));
			expect(getState().logs.map((l) => l.timestamp)).toEqual([1, 2, 3]);
		});

		it("trims oldest logs when exceeding MAX_LOGS (1000)", () => {
			for (let i = 0; i < 1001; i++) {
				getState().addLog(makeEntry(i));
			}
			expect(getState().logs).toHaveLength(1000);
			// First entry (index 0) should have been trimmed
			expect(getState().logs[0].timestamp).toBe(1);
		});

		it("trims correctly when adding many beyond limit", () => {
			for (let i = 0; i < 1050; i++) {
				getState().addLog(makeEntry(i));
			}
			expect(getState().logs).toHaveLength(1000);
			expect(getState().logs[0].timestamp).toBe(50);
			expect(getState().logs[999].timestamp).toBe(1049);
		});

		it("keeps exactly 1000 after multiple overflows", () => {
			// Add 999, then add 5 more (total 1004)
			for (let i = 0; i < 999; i++) {
				getState().addLog(makeEntry(i));
			}
			expect(getState().logs).toHaveLength(999);

			for (let i = 999; i < 1004; i++) {
				getState().addLog(makeEntry(i));
			}
			expect(getState().logs).toHaveLength(1000);
		});
	});

	describe("addLog edge cases", () => {
		it("at exactly MAX_LOGS (1000) does not trim", () => {
			for (let i = 0; i < 1000; i++) {
				getState().addLog(makeEntry(i));
			}
			expect(getState().logs).toHaveLength(1000);
			expect(getState().logs[0].timestamp).toBe(0);
		});

		it("at MAX_LOGS+1 (1001) trims exactly one", () => {
			for (let i = 0; i < 1001; i++) {
				getState().addLog(makeEntry(i));
			}
			expect(getState().logs).toHaveLength(1000);
			expect(getState().logs[0].timestamp).toBe(1);
			expect(getState().logs[999].timestamp).toBe(1000);
		});

		it("preserves all log fields", () => {
			const entry = {
				timestamp: 42,
				level: "error" as const,
				source: "my-module",
				message: "something broke",
			};
			getState().addLog(entry);
			expect(getState().logs[0]).toEqual(entry);
		});

		it("clear then addLog cycle works correctly", () => {
			for (let i = 0; i < 500; i++) {
				getState().addLog(makeEntry(i));
			}
			getState().clear();
			expect(getState().logs).toHaveLength(0);

			getState().addLog(makeEntry(9999));
			expect(getState().logs).toHaveLength(1);
			expect(getState().logs[0].timestamp).toBe(9999);
		});
	});

	describe("clear", () => {
		it("resets logs to empty array", () => {
			getState().addLog(makeEntry(1));
			getState().addLog(makeEntry(2));
			getState().clear();
			expect(getState().logs).toEqual([]);
		});

		it("is idempotent on empty state", () => {
			getState().clear();
			expect(getState().logs).toEqual([]);
		});
	});
});
