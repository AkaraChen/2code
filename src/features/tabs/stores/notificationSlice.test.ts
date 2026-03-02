import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";

enableMapSet();
import { createNotificationSlice, type NotificationSlice } from "./notificationSlice";

const useMockStore = create<NotificationSlice>()(
	immer((...a) => (createNotificationSlice as any)(...a))
);

describe("notificationSlice", () => {
	beforeEach(() => {
		useMockStore.setState({ notifiedTabs: new Set<string>() });
	});

	it("should mark a tab as notified", () => {
		useMockStore.getState().markNotified("tab1");
		expect(useMockStore.getState().notifiedTabs.has("tab1")).toBe(true);
	});

	it("should mark a tab as read", () => {
		useMockStore.getState().markNotified("tab1");
		useMockStore.getState().markRead("tab1");
		expect(useMockStore.getState().notifiedTabs.has("tab1")).toBe(false);
	});
});
