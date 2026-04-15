import { describe, expect, it } from "vitest";
import { shouldBypassTerminalLinkConfirm } from "./linkOpening";

describe("shouldBypassTerminalLinkConfirm", () => {
	it("bypasses the confirmation dialog for Ctrl+Click", () => {
		expect(
			shouldBypassTerminalLinkConfirm({
				ctrlKey: true,
			}),
		).toBe(true);
	});

	it("requires confirmation for regular clicks", () => {
		expect(
			shouldBypassTerminalLinkConfirm({
				ctrlKey: false,
			}),
		).toBe(false);
	});
});
