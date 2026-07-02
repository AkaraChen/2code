import { beforeEach, describe, expect, it } from "vitest";
import {
	HOT_PROFILE_LIMIT,
	isRenderedProfileHot,
	selectHotProfileIds,
	setRenderedHotProfileIds,
	useTerminalActivationStore,
} from "./activationStore";

function resetStore() {
	useTerminalActivationStore.getState().reset();
}

describe("selectHotProfileIds", () => {
	beforeEach(resetStore);

	it("returns an empty list for no profiles", () => {
		expect(selectHotProfileIds([], null, {})).toEqual([]);
	});

	it("keeps the active profile when it is the only profile", () => {
		expect(selectHotProfileIds(["profile-1"], "profile-1", {})).toEqual([
			"profile-1",
		]);
	});

	it("returns the active profile plus the most recently activated others", () => {
		const result = selectHotProfileIds(
			["profile-1", "profile-2", "profile-3", "profile-4", "profile-5"],
			"profile-5",
			{
				"profile-1": 10,
				"profile-2": 40,
				"profile-3": 20,
				"profile-4": 30,
				"profile-5": 50,
			},
			2,
		);

		expect(result).toEqual(["profile-5", "profile-2", "profile-4"]);
	});

	it("keeps the active profile even when it is oldest", () => {
		const result = selectHotProfileIds(
			["profile-1", "profile-2", "profile-3", "profile-4", "profile-5"],
			"profile-1",
			{
				"profile-1": 1,
				"profile-2": 50,
				"profile-3": 40,
				"profile-4": 30,
				"profile-5": 20,
			},
			HOT_PROFILE_LIMIT,
		);

		expect(result).toEqual([
			"profile-1",
			"profile-2",
			"profile-3",
			"profile-4",
		]);
	});

	it("ignores an active profile that is not open", () => {
		expect(
			selectHotProfileIds(["profile-1", "profile-2"], "profile-3", {
				"profile-1": 10,
				"profile-2": 20,
				"profile-3": 30,
			}),
		).toEqual(["profile-2", "profile-1"]);
	});

	it("tracks the rendered hot set for terminal cleanup decisions", () => {
		setRenderedHotProfileIds(["profile-1", "profile-3"]);

		expect(isRenderedProfileHot("profile-1")).toBe(true);
		expect(isRenderedProfileHot("profile-2")).toBe(false);
		expect(isRenderedProfileHot("profile-3")).toBe(true);
	});
});
