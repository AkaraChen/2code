import { beforeEach, describe, expect, it } from "vitest";
import { tauriStorage } from "@/shared/lib/tauriStorage";
import { useNotificationStore } from "./notificationStore";

async function resetStore() {
	useNotificationStore.setState({ enabled: false, sound: "Ping" });
	await tauriStorage.removeItem("notification-settings");
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

	it("preserves version 0 persisted notification settings during migration", async () => {
		await tauriStorage.setItem(
			"notification-settings",
			JSON.stringify({
				state: { enabled: true, sound: "Glass" },
				version: 0,
			}),
		);

		await useNotificationStore.persist.rehydrate();

		expect(getState().enabled).toBe(true);
		expect(getState().sound).toBe("Glass");
	});
});
