import { describe, expect, it } from "vitest";
import { getTerminalTabIcon } from "./terminalTabIcon";

describe("getTerminalTabIcon", () => {
	it("caches icons by title", () => {
		expect(getTerminalTabIcon("codex")).toBe(getTerminalTabIcon("codex"));
		expect(getTerminalTabIcon("shell")).toBe(getTerminalTabIcon("shell"));
	});
});
