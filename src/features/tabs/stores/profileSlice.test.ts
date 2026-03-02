import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ProfileTabState } from "../types";
import { createProfileSlice, type ProfileSlice } from "./profileSlice";

// Mock store for testing just this slice
const useMockStore = create<ProfileSlice>()(
	immer((...a) => (createProfileSlice as any)(...a)),
);

describe("profileSlice", () => {
	beforeEach(() => {
		useMockStore.setState({ profiles: {} });
	});

	it("should remove a profile", () => {
		useMockStore.setState({
			profiles: {
				prof1: { tabs: [], activeTabId: null, counter: 0 },
			},
		});

		useMockStore.getState().removeProfile("prof1");

		expect(useMockStore.getState().profiles.prof1).toBeUndefined();
	});

	it("should restore a profile", () => {
		const profileState: ProfileTabState = {
			tabs: [],
			activeTabId: "tab1",
			counter: 5,
		};

		useMockStore.getState().restoreProfile("prof2", profileState);

		expect(useMockStore.getState().profiles.prof2).toEqual(profileState);
	});
});
