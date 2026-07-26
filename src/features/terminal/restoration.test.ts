import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	closePtySession,
	deletePtySessionRecord,
	restorePtySession,
} from "@/generated";
import {
	restorePendingTerminalTab,
	sessionHistory,
} from "./restoration";
import {
	useTerminalStore,
	type PendingTerminalRestore,
} from "./store";
import { takeRestoredHistory } from "./ptyHistoryIpc";

vi.mock("@/generated", () => ({
	closePtySession: vi.fn(),
	deletePtySessionRecord: vi.fn(),
	restorePtySession: vi.fn(),
}));

vi.mock("./ptyHistoryIpc", () => ({
	takeRestoredHistory: vi.fn(),
}));

vi.mock("consola", () => ({
	default: {
		error: vi.fn(),
	},
}));

const closePtySessionMock = vi.mocked(closePtySession);
const deletePtySessionRecordMock = vi.mocked(deletePtySessionRecord);
const restorePtySessionMock = vi.mocked(restorePtySession);
const takeRestoredHistoryMock = vi.mocked(takeRestoredHistory);

interface RestoreSessionResult {
	newSessionId: string;
	historyLen: number;
}
type GeneratedRestoreResult = Awaited<ReturnType<typeof restorePtySession>>;

function restoreResult(result: RestoreSessionResult) {
	return result as unknown as GeneratedRestoreResult;
}

const pendingRestore: PendingTerminalRestore = {
	oldSessionId: "old-session",
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
	closePtySessionMock.mockReset();
	closePtySessionMock.mockResolvedValue(undefined);
	deletePtySessionRecordMock.mockReset();
	deletePtySessionRecordMock.mockResolvedValue(undefined);
	restorePtySessionMock.mockReset();
	takeRestoredHistoryMock.mockReset();
	takeRestoredHistoryMock.mockResolvedValue(new Uint8Array());
}

function addPendingTab() {
	useTerminalStore
		.getState()
		.addRestoringTab("profile-1", "old-session", "Terminal 1", pendingRestore);
	return useTerminalStore.getState().profiles["profile-1"].tabs[0];
}

describe("restorePendingTerminalTab", () => {
	beforeEach(resetStore);

	it("restores a pending tab and swaps it to the live session id", async () => {
		restorePtySessionMock.mockResolvedValue(restoreResult({
			newSessionId: "new-session",
			historyLen: 3,
		}));
		takeRestoredHistoryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));

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

	it("deduplicates concurrent restore attempts for the same old session", async () => {
		let resolveRestore!: (value: RestoreSessionResult) => void;
		restorePtySessionMock.mockReturnValue(
			new Promise((resolve) => {
				resolveRestore = (value) => resolve(restoreResult(value));
			}),
		);
		const tab = addPendingTab();

		const first = restorePendingTerminalTab("profile-1", tab);
		const second = restorePendingTerminalTab("profile-1", tab);

		expect(second).toBe(first);
		expect(restorePtySessionMock).toHaveBeenCalledTimes(1);

		resolveRestore({ newSessionId: "new-session", historyLen: 0 });
		await first;
	});

	it("removes the pending tab when restore fails", async () => {
		restorePtySessionMock.mockRejectedValue(new Error("boom"));

		await restorePendingTerminalTab("profile-1", addPendingTab());

		expect(useTerminalStore.getState().profiles["profile-1"]).toBeUndefined();
	});

	it("closes the new session if the pending tab was closed before restore finished", async () => {
		let resolveRestore!: (value: RestoreSessionResult) => void;
		restorePtySessionMock.mockReturnValue(
			new Promise((resolve) => {
				resolveRestore = (value) => resolve(restoreResult(value));
			}),
		);
		const restorePromise = restorePendingTerminalTab("profile-1", addPendingTab());

		useTerminalStore.getState().closeTab("profile-1", "old-session");
		resolveRestore({ newSessionId: "new-session", historyLen: 1 });
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
