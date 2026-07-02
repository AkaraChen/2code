import { describe, expect, it } from "vitest";
import {
	isAllowedTerminalLinkScheme,
	shouldBypassTerminalLinkConfirm,
} from "./linkOpening";

describe("isAllowedTerminalLinkScheme", () => {
	it("allows http and https links", () => {
		expect(isAllowedTerminalLinkScheme("https://example.com")).toBe(true);
		expect(isAllowedTerminalLinkScheme("http://example.com")).toBe(true);
	});

	it("rejects non-http schemes", () => {
		expect(isAllowedTerminalLinkScheme("file:///etc/hosts")).toBe(false);
		expect(isAllowedTerminalLinkScheme("mailto:user@example.com")).toBe(false);
	});

	it("rejects invalid URLs", () => {
		expect(isAllowedTerminalLinkScheme("not a url")).toBe(false);
	});
});

describe("shouldBypassTerminalLinkConfirm", () => {
	it("returns true for ctrl-click", () => {
		expect(shouldBypassTerminalLinkConfirm({ ctrlKey: true })).toBe(true);
	});

	it("returns false without ctrl", () => {
		expect(shouldBypassTerminalLinkConfirm({ ctrlKey: false })).toBe(false);
	});
});
