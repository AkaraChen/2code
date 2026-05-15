import { describe, expect, it } from "vitest";
import { getNextTopbarControlsAfterDrag } from "./TopBarSettings";
import type { ControlId } from "./types";

describe("getNextTopbarControlsAfterDrag", () => {
	const controls: ControlId[] = ["github-desktop", "vscode", "git-diff"];

	it("reorders active controls", () => {
		expect(
			getNextTopbarControlsAfterDrag(controls, "git-diff", "github-desktop"),
		).toEqual(["git-diff", "github-desktop", "vscode"]);
	});

	it("removes active controls dropped into available controls", () => {
		expect(
			getNextTopbarControlsAfterDrag(controls, "vscode", "available-area"),
		).toEqual(["github-desktop", "git-diff"]);
	});

	it("adds inactive controls into the preview area", () => {
		expect(
			getNextTopbarControlsAfterDrag(controls, "pr-status", "preview-area"),
		).toEqual(["github-desktop", "vscode", "git-diff", "pr-status"]);
	});

	it("returns null when nothing changes", () => {
		expect(
			getNextTopbarControlsAfterDrag(controls, "vscode", "vscode"),
		).toBeNull();
	});
});
