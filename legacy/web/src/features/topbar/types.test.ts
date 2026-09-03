import { describe, expect, it } from "vitest";
import {
	editorAppIds,
	isEditorAppId,
	isLaunchAppId,
	isTerminalAppId,
	launchAppIds,
	staticControlIds,
	terminalAppIds,
} from "./types";

describe("topbar types", () => {
	it("accepts every launch-app id", () => {
		for (const id of launchAppIds) {
			expect(isLaunchAppId(id)).toBe(true);
		}
	});

	it("rejects static controls and unknown ids", () => {
		for (const id of staticControlIds) {
			expect(isLaunchAppId(id)).toBe(false);
		}
		expect(isLaunchAppId("unknown-app")).toBe(false);
	});

	it("classifies editor and terminal apps disjointly", () => {
		for (const id of editorAppIds) {
			expect(isEditorAppId(id)).toBe(true);
			expect(isTerminalAppId(id)).toBe(false);
		}
		for (const id of terminalAppIds) {
			expect(isTerminalAppId(id)).toBe(true);
			expect(isEditorAppId(id)).toBe(false);
		}
		expect(isEditorAppId("github-desktop")).toBe(false);
		expect(isTerminalAppId("github-desktop")).toBe(false);
	});
});
