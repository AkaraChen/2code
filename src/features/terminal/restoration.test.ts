import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	closePtySession,
	deletePtySessionRecord,
	getSessionBackend,
	restorePtySession,
} from "@/generated";
import {
	hydrateRestorableSessions,
	restorePendingTerminalTab,
	sessionHistory,
	type RestorableSession,
} from "./restoration";
import {
	useTerminalStore,
	type PendingTerminalRestore,
} from "./store";

vi.mock("@/generated", () => ({
	closePtySession: vi.fn(),
	deletePtySessionRecord: vi.fn(),
	getSessionBackend: vi.fn(),
	restorePtySession: vi.fn(),
}));

vi.mock("consola", () => ({
	default: {
		error: vi.fn(),
	},
}));

const closePtySessionMock = vi.mocked(closePtySession);
const deletePtySessionRecordMock = vi.mocked(deletePtySessionRecord);
const getSessionBackendMock = vi.mocked(getSessionBackend);
const restorePtySessionMock = vi.mocked(restorePtySession);

const pendingRestore: PendingTerminalRestore = {
	oldSessionId: "old-session",
	shell: "/bin/zsh",
	cwd: "/repo",
	rows: 24,
	cols: 80,
};

const herdrSession: RestorableSession = {
	id: "herdr-sess",
	profile_id: "profile-1",
	title: "Claude",
	shell: "/bin/zsh",
	cwd: "/repo",
	rows: 24,
	cols: 80,
};

const localSession: RestorableSession = {
	id: "local-sess",
	profile_id: "profile-1",
	title: "Terminal 1",
	shell: "/bin/zsh",
	cwd: "/repo",
	rows: 24,
	cols: 80,
};

function resetStore() {
	useTerminalStore.setState({
		profiles: {},
		agentStatuses: {},
		agentCompletions: {},
		sessionProfileIds: {},
	});
	sessionHistory.clear();
	localStorage.clear();
	closePtySessionMock.mockReset();
	closePtySessionMock.mockResolvedValue(undefined);
	deletePtySessionRecordMock.mockReset();
	deletePtySessionRecordMock.mockResolvedValue(undefined);
	restorePtySessionMock.mockReset();
	getSessionBackendMock.mockReset();
	getSessionBackendMock.mockResolvedValue("local");
}

function addPendingTab() {
	useTerminalStore
		.getState()
		.addRestoringTab("profile-1", "old-session", "Terminal 1", pendingRestore);
	return useTerminalStore.getState().profiles["profile-1"].tabs[0];
}

describe("hydrateRestorableSessions", () => {
	beforeEach(resetStore);

	it("reattaches Herdr sessions as live tabs with the same id", async () => {
		localStorage.setItem("terminal-buffer:herdr-sess", "CACHED_SCROLLBACK");
		localStorage.setItem("terminal-dims:herdr-sess", "{\"cols\":80,\"rows\":24}");
		getSessionBackendMock.mockImplementation(async ({ sessionId }) =>
			sessionId === "herdr-sess" ? "herdr" : "local",
		);

		await hydrateRestorableSessions([herdrSession, localSession]);

		expect(restorePtySessionMock).not.toHaveBeenCalled();
		expect(getSessionBackendMock).toHaveBeenCalledWith({
			sessionId: "herdr-sess",
		});
		expect(useTerminalStore.getState().profiles["profile-1"]).toMatchObject({
			tabs: [
				{ id: "herdr-sess", title: "Claude" },
				{
					id: "local-sess",
					title: "Terminal 1",
					restore: {
						oldSessionId: "local-sess",
						shell: "/bin/zsh",
						cwd: "/repo",
						rows: 24,
						cols: 80,
					},
				},
			],
		});
		expect(
			useTerminalStore.getState().profiles["profile-1"].tabs[0].restore,
		).toBeUndefined();
		expect(localStorage.getItem("terminal-buffer:herdr-sess")).toBeNull();
		expect(localStorage.getItem("terminal-dims:herdr-sess")).toBe(
			'{"cols":80,"rows":24}',
		);
		expect(sessionHistory.size).toBe(0);
	});

	it("skips a session when backend resolution fails instead of restoring it as Local", async () => {
		getSessionBackendMock.mockRejectedValueOnce(new Error("offline"));

		await hydrateRestorableSessions([herdrSession]);

		expect(restorePtySessionMock).not.toHaveBeenCalled();
		expect(useTerminalStore.getState().profiles["profile-1"]).toBeUndefined();
	});
});

describe("restorePendingTerminalTab", () => {
	beforeEach(resetStore);

	it("restores a pending tab and swaps it to the live session id", async () => {
		restorePtySessionMock.mockResolvedValue({
			newSessionId: "new-session",
			history: [1, 2, 3],
		});

		await restorePendingTerminalTab("profile-1", addPendingTab());

		expect(restorePtySessionMock).toHaveBeenCalledWith({
			oldSessionId: "old-session",
			meta: { profileId: "profile-1", title: "Terminal 1" },
			config: {
				shell: "/bin/zsh",
				cwd: "/repo",
				rows: 24,
				cols: 80,
				startupCommands: [],
			},
		});
		expect(useTerminalStore.getState().profiles["profile-1"]).toMatchObject({
			activeTabId: "new-session",
			tabs: [{ id: "new-session", title: "Terminal 1" }],
		});
		expect(sessionHistory.get("new-session")).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("reattaches a mapped Herdr id without restorePtySession or a new session id", async () => {
		getSessionBackendMock.mockResolvedValue("herdr");
		localStorage.setItem("terminal-buffer:old-session", "CACHED_SCROLLBACK");

		await restorePendingTerminalTab("profile-1", addPendingTab());

		expect(restorePtySessionMock).not.toHaveBeenCalled();
		expect(closePtySessionMock).not.toHaveBeenCalled();
		expect(useTerminalStore.getState().profiles["profile-1"]).toMatchObject({
			activeTabId: "old-session",
			tabs: [{ id: "old-session", title: "Terminal 1" }],
		});
		expect(
			useTerminalStore.getState().profiles["profile-1"].tabs[0].restore,
		).toBeUndefined();
		expect(localStorage.getItem("terminal-buffer:old-session")).toBeNull();
		expect(sessionHistory.size).toBe(0);
	});

	it("deduplicates concurrent restore attempts for the same old session", async () => {
		let resolveRestore!: (value: {
			newSessionId: string;
			history: number[];
		}) => void;
		restorePtySessionMock.mockReturnValue(
			new Promise((resolve) => {
				resolveRestore = resolve;
			}),
		);
		const tab = addPendingTab();

		const first = restorePendingTerminalTab("profile-1", tab);
		const second = restorePendingTerminalTab("profile-1", tab);

		expect(second).toBe(first);
		expect(getSessionBackendMock).toHaveBeenCalledTimes(1);

		await Promise.resolve();
		expect(restorePtySessionMock).toHaveBeenCalledTimes(1);

		resolveRestore({ newSessionId: "new-session", history: [] });
		await first;
	});

	it("removes the pending tab when restore fails", async () => {
		restorePtySessionMock.mockRejectedValue(new Error("boom"));

		await restorePendingTerminalTab("profile-1", addPendingTab());

		expect(useTerminalStore.getState().profiles["profile-1"]).toBeUndefined();
	});

	it("closes the new session if the pending tab was closed before restore finished", async () => {
		let resolveRestore!: (value: {
			newSessionId: string;
			history: number[];
		}) => void;
		restorePtySessionMock.mockReturnValue(
			new Promise((resolve) => {
				resolveRestore = resolve;
			}),
		);
		const restorePromise = restorePendingTerminalTab("profile-1", addPendingTab());

		useTerminalStore.getState().closeTab("profile-1", "old-session");
		resolveRestore({ newSessionId: "new-session", history: [1] });
		await restorePromise;

		expect(closePtySessionMock).toHaveBeenCalledWith({
			sessionId: "new-session",
		});
		expect(deletePtySessionRecordMock).toHaveBeenCalledWith({
			sessionId: "new-session",
		});
		expect(sessionHistory.has("new-session")).toBe(false);
	});
});
