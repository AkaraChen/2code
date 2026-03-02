import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "./index";

function resetStore() {
	useSettingsStore.setState({
		notificationEnabled: false,
		notificationSound: "Ping",
	});
}

function getState() {
	return useSettingsStore.getState();
}

describe("notificationSlice parameters", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("notificationEnabled defaults to false", () => {
			expect(getState().notificationEnabled).toBe(false);
		});

		it("notificationSound defaults to 'Ping'", () => {
			expect(getState().notificationSound).toBe("Ping");
		});
	});

	describe("setNotificationEnabled", () => {
		it("sets notificationEnabled to true", () => {
			getState().setNotificationEnabled(true);
			expect(getState().notificationEnabled).toBe(true);
		});

		it("sets notificationEnabled to false", () => {
			getState().setNotificationEnabled(true);
			getState().setNotificationEnabled(false);
			expect(getState().notificationEnabled).toBe(false);
		});
	});

	describe("setNotificationSound", () => {
		it("updates sound name", () => {
			getState().setNotificationSound("Boop");
			expect(getState().notificationSound).toBe("Boop");
		});
	});
});
