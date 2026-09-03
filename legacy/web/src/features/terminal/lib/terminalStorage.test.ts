import { beforeEach, describe, expect, it } from "vitest";
import {
	BUFFER_STORAGE_PREFIX,
	DIMS_STORAGE_PREFIX,
	removeTerminalStorage,
	sweepTerminalStorage,
} from "./terminalStorage";

describe("removeTerminalStorage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("removes buffer and dimension keys for a session", () => {
		localStorage.setItem(`${BUFFER_STORAGE_PREFIX}session-1`, "buffer");
		localStorage.setItem(`${DIMS_STORAGE_PREFIX}session-1`, "{}");
		localStorage.setItem("unrelated", "value");

		removeTerminalStorage("session-1");

		expect(localStorage.getItem(`${BUFFER_STORAGE_PREFIX}session-1`)).toBeNull();
		expect(localStorage.getItem(`${DIMS_STORAGE_PREFIX}session-1`)).toBeNull();
		expect(localStorage.getItem("unrelated")).toBe("value");
	});

	it("tolerates missing keys", () => {
		expect(() => removeTerminalStorage("missing")).not.toThrow();
	});
});

describe("sweepTerminalStorage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("removes orphaned terminal keys and keeps live or unrelated keys", () => {
		localStorage.setItem(`${BUFFER_STORAGE_PREFIX}live`, "buffer");
		localStorage.setItem(`${DIMS_STORAGE_PREFIX}live`, "{}");
		localStorage.setItem(`${BUFFER_STORAGE_PREFIX}old`, "old buffer");
		localStorage.setItem(`${DIMS_STORAGE_PREFIX}old`, "{}");
		localStorage.setItem("other", "value");

		const removed = sweepTerminalStorage(new Set(["live"]));

		expect(removed).toBe(2);
		expect(localStorage.getItem(`${BUFFER_STORAGE_PREFIX}live`)).toBe("buffer");
		expect(localStorage.getItem(`${DIMS_STORAGE_PREFIX}live`)).toBe("{}");
		expect(localStorage.getItem(`${BUFFER_STORAGE_PREFIX}old`)).toBeNull();
		expect(localStorage.getItem(`${DIMS_STORAGE_PREFIX}old`)).toBeNull();
		expect(localStorage.getItem("other")).toBe("value");
	});
});
