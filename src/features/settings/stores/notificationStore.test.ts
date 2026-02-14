import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "./notificationStore";

function resetStore() {
	useNotificationStore.setState({ enabled: false, sound: "Ping" });
}

function getState() {
	return useNotificationStore.getState();
}

describe("useNotificationStore", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("enabled defaults to false", () => {
			expect(getState().enabled).toBe(false);
		});

		it("sound defaults to 'Ping'", () => {
			expect(getState().sound).toBe("Ping");
		});
	});

	describe("setEnabled", () => {
		it("sets enabled to true", () => {
			getState().setEnabled(true);
			expect(getState().enabled).toBe(true);
		});

		it("sets enabled to false", () => {
			getState().setEnabled(true);
			getState().setEnabled(false);
			expect(getState().enabled).toBe(false);
		});
	});

	describe("setSound", () => {
		it("updates sound name", () => {
			getState().setSound("Boop");
			expect(getState().sound).toBe("Boop");
		});
	});
});
