import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionBackend } from "@/generated";
import agentsMd from "./AGENTS.md?raw";
import claudeMd from "./CLAUDE.md?raw";
import {
	hydrateRestorableSessions,
	restorePendingTerminalTab,
	type RestorableSession,
} from "./restoration";
import {
	useTerminalStore,
	type PendingTerminalRestore,
} from "./store";

vi.mock("@/generated", () => ({
	getSessionBackend: vi.fn(),
}));

vi.mock("consola", () => ({
	default: {
		error: vi.fn(),
	},
}));

const getSessionBackendMock = vi.mocked(getSessionBackend);

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

function resetStore() {
	useTerminalStore.setState({
		profiles: {},
		agentStatuses: {},
		agentCompletions: {},
		sessionProfileIds: {},
	});
	localStorage.clear();
	getSessionBackendMock.mockReset();
	getSessionBackendMock.mockResolvedValue("herdr");
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

		await hydrateRestorableSessions([herdrSession]);

		expect(getSessionBackendMock).toHaveBeenCalledWith({
			sessionId: "herdr-sess",
		});
		expect(useTerminalStore.getState().profiles["profile-1"]).toMatchObject({
			tabs: [{ id: "herdr-sess", title: "Claude" }],
		});
		expect(
			useTerminalStore.getState().profiles["profile-1"].tabs[0].restore,
		).toBeUndefined();
		expect(localStorage.getItem("terminal-buffer:herdr-sess")).toBeNull();
		expect(localStorage.getItem("terminal-dims:herdr-sess")).toBe(
			'{"cols":80,"rows":24}',
		);
	});

	it("skips a session when backend resolution fails instead of restoring it as Local", async () => {
		getSessionBackendMock.mockRejectedValueOnce(new Error("offline"));

		await hydrateRestorableSessions([herdrSession]);

		expect(useTerminalStore.getState().profiles["profile-1"]).toBeUndefined();
	});
});

describe("restorePendingTerminalTab", () => {
	beforeEach(resetStore);

	it("reattaches a pending tab on the same Herdr pane id", async () => {
		localStorage.setItem("terminal-buffer:old-session", "CACHED_SCROLLBACK");

		await restorePendingTerminalTab("profile-1", addPendingTab());

		expect(useTerminalStore.getState().profiles["profile-1"]).toMatchObject({
			activeTabId: "old-session",
			tabs: [{ id: "old-session", title: "Terminal 1" }],
		});
		expect(
			useTerminalStore.getState().profiles["profile-1"].tabs[0].restore,
		).toBeUndefined();
		expect(localStorage.getItem("terminal-buffer:old-session")).toBeNull();
	});

	it("deduplicates concurrent restore attempts for the same old session", async () => {
		let resolveBackend!: (value: "herdr") => void;
		getSessionBackendMock.mockReturnValue(
			new Promise((resolve) => {
				resolveBackend = resolve;
			}),
		);
		const tab = addPendingTab();

		const first = restorePendingTerminalTab("profile-1", tab);
		const second = restorePendingTerminalTab("profile-1", tab);

		expect(second).toBe(first);
		expect(getSessionBackendMock).toHaveBeenCalledTimes(1);

		resolveBackend("herdr");
		await first;
	});

	it("removes the pending tab when restore fails", async () => {
		getSessionBackendMock.mockRejectedValue(new Error("boom"));

		await restorePendingTerminalTab("profile-1", addPendingTab());

		expect(useTerminalStore.getState().profiles["profile-1"]).toBeUndefined();
	});
});

describe("terminal KEY PATTERNS", () => {
	it("describes restore as reattach of a live Herdr pane_id", () => {
		expect(agentsMd).toBe(claudeMd);
		const keyPatterns = agentsMd
			.split("## KEY PATTERNS")[1]
			.split("## WHERE TO LOOK")[0];
		expect(keyPatterns).not.toContain("Fetch closed session history from DB");
		expect(keyPatterns).not.toContain(
			"Pass old `session.id` as `restoreFrom` prop",
		);
		expect(keyPatterns).toContain("reattaches each live `pane_id`");
	});
});
