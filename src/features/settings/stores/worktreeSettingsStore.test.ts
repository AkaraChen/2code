import { beforeEach, describe, expect, it } from "vitest";
import { useWorktreeSettingsStore } from "./worktreeSettingsStore";

function resetStore() {
	useWorktreeSettingsStore.setState({ defaultWorktreeDir: "" });
	localStorage.clear();
}

function getState() {
	return useWorktreeSettingsStore.getState();
}

describe("useWorktreeSettingsStore", () => {
	beforeEach(resetStore);

	it("starts without a default worktree directory", () => {
		expect(getState().defaultWorktreeDir).toBe("");
	});

	it("trims and stores the default worktree directory", () => {
		getState().setDefaultWorktreeDir("  /Volumes/dev/worktrees  ");

		expect(getState().defaultWorktreeDir).toBe(
			"/Volumes/dev/worktrees",
		);
	});

	it("clears the default worktree directory", () => {
		getState().setDefaultWorktreeDir("/tmp/worktrees");
		getState().clearDefaultWorktreeDir();

		expect(getState().defaultWorktreeDir).toBe("");
	});

	it("normalizes persisted default worktree directory on migration", async () => {
		localStorage.setItem(
			"worktree-settings",
			JSON.stringify({
				state: { defaultWorktreeDir: "  /tmp/worktrees  " },
				version: 0,
			}),
		);

		await useWorktreeSettingsStore.persist.rehydrate();

		expect(getState().defaultWorktreeDir).toBe("/tmp/worktrees");
	});
});
