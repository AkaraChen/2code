import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand";
import { syncStoreAcrossWindows } from "./broadcastStoreSync";

// jsdom has no BroadcastChannel; this fake routes messages synchronously
// between instances sharing a name, mimicking two webview windows.
class FakeBroadcastChannel {
	private static registry = new Map<string, Set<FakeBroadcastChannel>>();
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(readonly name: string) {
		let peers = FakeBroadcastChannel.registry.get(name);
		if (!peers) {
			peers = new Set();
			FakeBroadcastChannel.registry.set(name, peers);
		}
		peers.add(this);
	}

	postMessage(data: unknown) {
		const peers = FakeBroadcastChannel.registry.get(this.name);
		if (!peers) return;
		for (const peer of peers) {
			if (peer === this) continue;
			peer.onmessage?.({ data } as MessageEvent);
		}
	}

	close() {
		FakeBroadcastChannel.registry.get(this.name)?.delete(this);
	}
}

interface CounterState {
	count: number;
	label: string;
	increment: () => void;
}

function createCounterStore() {
	return createStore<CounterState>((set) => ({
		count: 0,
		label: "initial",
		increment: () => set((s) => ({ count: s.count + 1 })),
	}));
}

describe("syncStoreAcrossWindows", () => {
	beforeEach(() => {
		vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("applies changes from one store to the other", () => {
		const windowA = createCounterStore();
		const windowB = createCounterStore();
		const stopA = syncStoreAcrossWindows(windowA, "sync:test");
		const stopB = syncStoreAcrossWindows(windowB, "sync:test");

		windowA.getState().increment();
		windowA.setState({ label: "changed" });

		expect(windowB.getState().count).toBe(1);
		expect(windowB.getState().label).toBe("changed");

		stopA();
		stopB();
	});

	it("does not overwrite actions on the receiving store", () => {
		const windowA = createCounterStore();
		const windowB = createCounterStore();
		const originalIncrement = windowB.getState().increment;
		const stopA = syncStoreAcrossWindows(windowA, "sync:test");
		const stopB = syncStoreAcrossWindows(windowB, "sync:test");

		windowA.getState().increment();

		expect(windowB.getState().increment).toBe(originalIncrement);

		stopA();
		stopB();
	});

	it("does not echo remote updates back (no ping-pong)", () => {
		const windowA = createCounterStore();
		const windowB = createCounterStore();
		const stopA = syncStoreAcrossWindows(windowA, "sync:test");
		const stopB = syncStoreAcrossWindows(windowB, "sync:test");

		// With synchronous delivery, a re-broadcast from the receiver
		// would recurse infinitely — completing at all proves the guard.
		windowA.getState().increment();

		expect(windowA.getState().count).toBe(1);
		expect(windowB.getState().count).toBe(1);

		stopA();
		stopB();
	});

	it("stops syncing after the returned cleanup runs", () => {
		const windowA = createCounterStore();
		const windowB = createCounterStore();
		const stopA = syncStoreAcrossWindows(windowA, "sync:test");
		const stopB = syncStoreAcrossWindows(windowB, "sync:test");

		stopB();
		windowA.getState().increment();

		expect(windowB.getState().count).toBe(0);
		stopA();
	});

	it("is a no-op when BroadcastChannel is unavailable", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const store = createCounterStore();

		expect(() => {
			const stop = syncStoreAcrossWindows(store, "sync:test");
			store.getState().increment();
			stop();
		}).not.toThrow();
	});
});
