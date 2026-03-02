import { vi } from "vitest";

// ─── Fix Node.js 22+ experimental localStorage conflicting with jsdom ───
// Node.js 22+ ships an experimental localStorage that requires --localstorage-file.
// Without it, the API object exists but setItem/getItem may not work.
// Zustand persist middleware picks up the broken one instead of jsdom's working one.
{
	const store = new Map<string, string>();
	const localStorageFallback: Storage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => store.clear(),
		get length() {
			return store.size;
		},
		key: (index: number) => [...store.keys()][index] ?? null,
	};
	globalThis.localStorage = localStorageFallback;
}

// ─── Mock @tauri-apps/api/event ───
// terminal/store.ts calls listen() at module scope
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
	emit: vi.fn(),
}));

// ─── Mock @tauri-apps/api/core ───
// debugStore.ts imports Channel
vi.mock("@tauri-apps/api/core", () => {
	class MockChannel {
		onmessage: ((msg: unknown) => void) | null = null;
	}
	return {
		Channel: MockChannel,
		invoke: vi.fn(),
	};
});

// ─── Mock @tauri-apps/plugin-store ───
// tauriStorage.ts creates a LazyStore at module scope
vi.mock("@tauri-apps/plugin-store", () => {
	const storage = new Map<string, unknown>();
	class MockLazyStore {
		async get(key: string) {
			return storage.get(key) ?? null;
		}
		async set(key: string, value: unknown) {
			storage.set(key, value);
		}
		async delete(key: string) {
			storage.delete(key);
		}
	}
	return { LazyStore: MockLazyStore };
});

// ─── Mock all generated Tauri IPC commands ───
vi.mock("@/generated", () => ({
	startDebugLog: vi.fn(),
	stopDebugLog: vi.fn(),
	createPtySession: vi.fn(() => Promise.resolve("mock-session-id")),
	closePtySession: vi.fn(() => Promise.resolve()),
	deletePtySessionRecord: vi.fn(() => Promise.resolve()),
	listProjects: vi.fn(() => Promise.resolve([])),
	listProjectSessions: vi.fn(() => Promise.resolve([])),
	getSessionOutput: vi.fn(() => Promise.resolve([])),
	listProjectAgentSessions: vi.fn(() => Promise.resolve([])),
	reconnectAgentSession: vi.fn(() =>
		Promise.resolve({
			id: "mock-reconnected-id",
			agent: "mock",
			acpSessionId: "acp-mock",
		}),
	),
	listAgentSessionEvents: vi.fn(() => Promise.resolve([])),
}));

// ─── Mock @/generated/types ───
vi.mock("@/generated/types", () => ({}));
