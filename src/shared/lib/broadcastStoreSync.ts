import type { StoreApi } from "zustand";

/**
 * Mirrors a Zustand store's data across windows via BroadcastChannel.
 *
 * The main window and the settings window are separate webviews, each
 * holding its own in-memory copy of every store. Persist middleware only
 * writes storage — it never notifies the other window — so a change made
 * in the settings window would not appear in the main window until
 * restart. This bridges that gap: every local change is posted on a
 * channel, and messages from the other window are applied via setState.
 *
 * Only non-function fields are broadcast (actions stay local), and a
 * guard flag prevents an applied remote update from being re-broadcast,
 * which would otherwise ping-pong between windows forever.
 */
export function syncStoreAcrossWindows<T extends object>(
	store: StoreApi<T>,
	channelName: string,
): () => void {
	if (typeof BroadcastChannel === "undefined") return () => {};

	const channel = new BroadcastChannel(channelName);
	let applyingRemote = false;

	channel.onmessage = (event: MessageEvent<Partial<T>>) => {
		applyingRemote = true;
		try {
			store.setState(event.data);
		} finally {
			applyingRemote = false;
		}
	};

	const unsubscribe = store.subscribe((state) => {
		if (applyingRemote) return;
		channel.postMessage(extractData(state));
	});

	return () => {
		unsubscribe();
		channel.close();
	};
}

function extractData<T extends object>(state: T): Partial<T> {
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(state)) {
		if (typeof value !== "function") data[key] = value;
	}
	return data as Partial<T>;
}
