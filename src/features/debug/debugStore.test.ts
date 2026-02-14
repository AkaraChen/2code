import { beforeEach, describe, expect, it, vi } from "vitest";
import { startDebugLog, stopDebugLog } from "@/generated";
import { useDebugLogStore } from "./debugLogStore";
import { useDebugStore } from "./debugStore";

function resetStore() {
	useDebugStore.setState({ enabled: false, panelOpen: false });
	useDebugLogStore.setState({ logs: [] });
	vi.mocked(startDebugLog).mockClear();
	vi.mocked(stopDebugLog).mockClear();
}

function getState() {
	return useDebugStore.getState();
}

describe("useDebugStore", () => {
	beforeEach(resetStore);

	describe("initial state", () => {
		it("enabled defaults to false", () => {
			expect(getState().enabled).toBe(false);
		});

		it("panelOpen defaults to false", () => {
			expect(getState().panelOpen).toBe(false);
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

	describe("setPanelOpen", () => {
		it("sets panelOpen to true", () => {
			getState().setPanelOpen(true);
			expect(getState().panelOpen).toBe(true);
		});

		it("sets panelOpen to false", () => {
			getState().setPanelOpen(false);
			expect(getState().panelOpen).toBe(false);
		});
	});

	describe("togglePanel", () => {
		it("toggles panelOpen when enabled is true", () => {
			getState().setEnabled(true);
			getState().togglePanel();
			expect(getState().panelOpen).toBe(true);
			getState().togglePanel();
			expect(getState().panelOpen).toBe(false);
		});

		it("does not toggle panelOpen when enabled is false", () => {
			getState().setPanelOpen(false);
			getState().togglePanel();
			expect(getState().panelOpen).toBe(false);
		});
	});

	describe("syncDebugChannel (subscription)", () => {
		it("calls startDebugLog when enabled changes to true", () => {
			getState().setEnabled(true);
			expect(startDebugLog).toHaveBeenCalled();
		});

		it("calls stopDebugLog when enabled changes to false", () => {
			getState().setEnabled(true);
			vi.mocked(startDebugLog).mockClear();
			getState().setEnabled(false);
			expect(stopDebugLog).toHaveBeenCalled();
		});

		it("routes channel messages to debugLogStore via onmessage", () => {
			getState().setEnabled(true);

			// Extract the channel passed to startDebugLog
			const call = vi.mocked(startDebugLog).mock.calls[0];
			const channel = (
				call[0] as {
					onEvent: { onmessage: ((msg: unknown) => void) | null };
				}
			).onEvent;
			expect(channel).toBeDefined();
			expect(channel.onmessage).toBeTypeOf("function");

			// Simulate a message from the backend
			const entry = {
				timestamp: 123,
				level: "info" as const,
				source: "test-module",
				message: "hello from channel",
			};
			channel.onmessage!(entry);

			// Verify it was forwarded to debugLogStore
			const logs = useDebugLogStore.getState().logs;
			expect(logs).toHaveLength(1);
			expect(logs[0]).toEqual(entry);
		});
	});
});
