import { cleanup, render, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import type { HerdrTerminalFrame } from "@/generated";
import {
	clearPtyOutput,
	detachPtyOutput,
	flushPtyOutput,
	getPtySessionHistory,
	getSessionBackend,
	streamHerdrOutput,
	streamPtyOutput,
	writeToPty,
} from "@/generated";
import { Terminal } from "./Terminal";
import {
	herdrFullRedrawFrame,
	herdrIncrementalFrame,
	latin1,
} from "./lib/herdrTestFixtures";
import { useTerminalStore } from "./store";

const {
	readClipboardTextMock,
	TerminalMock,
	terminalInstances,
	toasterCreateMock,
	writeClipboardTextMock,
} = vi.hoisted(() => {
	interface MockTerminalInstance {
		fireSelectionChange: () => void;
		fireTitleChange: (title: string) => void;
		setSelection: (selection: string) => void;
		writes: unknown[];
		resetCount: number;
		csiHandlers: Array<{ final: string }>;
		fireData: (data: string) => void;
		fireBinary: (data: string) => void;
	}

	const terminalInstances: MockTerminalInstance[] = [];
	const writeClipboardTextMock = vi.fn();
	const readClipboardTextMock = vi.fn();
	const toasterCreateMock = vi.fn();

	class MockTerminal {
		cols: number;
		rows: number;
		element: HTMLElement | null = null;
		options: Record<string, unknown>;
		writes: unknown[] = [];
		resetCount = 0;
		csiHandlers: Array<{ final: string }> = [];
		buffer = {
			active: {
				length: 0,
				getLine: () => undefined,
			},
		};
		parser = {
			registerCsiHandler: (id: { final: string }) => {
				this.csiHandlers.push(id);
				return { dispose: vi.fn() };
			},
		};
		private selection = "";
		private selectionListeners: Array<() => void> = [];
		private titleListeners: Array<(title: string) => void> = [];
		private dataListeners: Array<(data: string) => void> = [];
		private binaryListeners: Array<(data: string) => void> = [];

		constructor(options: { cols: number; rows: number }) {
			this.cols = options.cols;
			this.rows = options.rows;
			this.options = { ...options };
			terminalInstances.push(this);
		}

		open(element: HTMLElement) {
			this.element = element;
		}

		focus() {}
		refresh() {}
		clear() {}
		reset() {
			this.resetCount += 1;
		}
		write(data: unknown, callback?: () => void) {
			this.writes.push(data);
			callback?.();
		}

		hasSelection() {
			return this.selection.length > 0;
		}

		getSelection() {
			return this.selection;
		}

		setSelection(selection: string) {
			this.selection = selection;
		}

		fireSelectionChange() {
			for (const listener of this.selectionListeners) listener();
		}

		fireTitleChange(title: string) {
			for (const listener of this.titleListeners) listener(title);
		}

		fireData(data: string) {
			for (const listener of this.dataListeners) listener(data);
		}

		fireBinary(data: string) {
			for (const listener of this.binaryListeners) listener(data);
		}

		onSelectionChange(listener: () => void) {
			this.selectionListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onTitleChange(listener: (title: string) => void) {
			this.titleListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onData(listener: (data: string) => void) {
			this.dataListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onBinary(listener: (data: string) => void) {
			this.binaryListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onResize() {
			return { dispose: vi.fn() };
		}

		attachCustomKeyEventHandler() {}

		registerLinkProvider() {
			return { dispose: vi.fn() };
		}
	}

	return {
		readClipboardTextMock,
		terminalInstances,
		toasterCreateMock,
		writeClipboardTextMock,
		TerminalMock: MockTerminal,
	};
});

vi.mock("@xterm/xterm", () => ({
	Terminal: TerminalMock,
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	readText: readClipboardTextMock,
	writeText: writeClipboardTextMock,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
	open: vi.fn(),
}));

vi.mock("@/generated", () => ({
	attachPtyOutput: vi.fn(() => Promise.resolve()),
	clearPtyOutput: vi.fn(() => Promise.resolve()),
	detachPtyOutput: vi.fn(() => Promise.resolve()),
	flushPtyOutput: vi.fn(() => Promise.resolve()),
	getPtySessionHistory: vi.fn(() => Promise.resolve([])),
	getSessionBackend: vi.fn(() => Promise.resolve("local")),
	listProjectSessions: vi.fn(() => Promise.resolve([])),
	listProjects: vi.fn(() => Promise.resolve([])),
	playSystemSound: vi.fn(() => Promise.resolve()),
	resizePty: vi.fn(() => Promise.resolve()),
	restorePtySession: vi.fn(() =>
		Promise.resolve({ newSessionId: "mock-session-id", history: [] }),
	),
	streamHerdrOutput: vi.fn(() => Promise.resolve()),
	streamPtyOutput: vi.fn(() => Promise.resolve()),
	writeToPty: vi.fn(() => Promise.resolve()),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toasterCreateMock,
		success: toasterCreateMock,
	},
}));

vi.mock("./FileLinkProvider", () => ({
	FileLinkProvider: class {
		setTerminal() {}
	},
}));

vi.mock("./TerminalLinkConfirmDialog", () => ({
	TerminalLinkConfirmDialog: () => null,
}));

vi.mock("./hooks", () => ({
	useTerminalTheme: () => ({ background: "#000000" }),
}));

vi.mock("./lib", () => ({
	applyTerminalFontFamilyCssVariable: vi.fn(),
	buildFontFamilyCss: (fontFamily: string) => fontFamily,
	BUFFER_STORAGE_PREFIX: "terminal-buffer:",
	DIMS_STORAGE_PREFIX: "terminal-dims:",
	createResizeScheduler: () => ({
		observe: vi.fn(),
		dispose: vi.fn(),
	}),
	createTerminalKeyEventHandler: () => () => true,
	getTerminalParkingContainer: () => document.body,
	installAttachedCanvasMetrics: () => ({
		patchedCharSize: true,
		patchedWidthCache: true,
		dispose: vi.fn(),
	}),
	installImagePasteFallback: () => vi.fn(),
	loadAddons: () => ({
		fitAddon: { fit: vi.fn() },
		progressAddon: {
			onChange: vi.fn(() => ({ dispose: vi.fn() })),
			progress: { state: 0, value: 0 },
		},
		serializeAddon: { serialize: vi.fn(() => "") },
		dispose: vi.fn(),
	}),
	measureAndResize: vi.fn(() => false),
	scheduleFontSettleRefit: vi.fn(),
	suppressQueryResponses: () => vi.fn(),
	TitleDebouncer: class {
		value = "";
		private listeners: Array<() => void> = [];
		set(value: string) {
			this.value = value;
			for (const listener of this.listeners) listener();
		}
		subscribe(listener: () => void) {
			this.listeners.push(listener);
			return () => {};
		}
		dispose() {}
	},
}));

function renderTerminal(isActive = false) {
	return render(
		<Terminal
			profileId="profile-1"
			sessionId="session-1"
			isActive={isActive}
		/>,
	);
}

function latestTerminal() {
	return terminalInstances[terminalInstances.length - 1]!;
}

function herdrChannel() {
	const call = (streamHerdrOutput as unknown as Mock).mock.calls[0] as
		| [{ onOutput: { onmessage: (frame: HerdrTerminalFrame) => void } }]
		| undefined;
	expect(call).toBeDefined();
	return call![0].onOutput;
}

describe("terminal select to copy", () => {
	const getPtySessionHistoryMock = getPtySessionHistory as unknown as Mock;

	beforeEach(() => {
		terminalInstances.length = 0;
		writeClipboardTextMock.mockReset();
		writeClipboardTextMock.mockResolvedValue(undefined);
		readClipboardTextMock.mockReset();
		toasterCreateMock.mockReset();
		getPtySessionHistoryMock.mockClear();
		getPtySessionHistoryMock.mockResolvedValue([]);
		(getSessionBackend as unknown as Mock).mockReset();
		(getSessionBackend as unknown as Mock).mockResolvedValue("local");
		(streamHerdrOutput as unknown as Mock).mockClear();
		(streamPtyOutput as unknown as Mock).mockClear();
		useTerminalStore.setState({
			profiles: {},
			agentStatuses: {},
			agentCompletions: {},
			sessionProfileIds: {},
		});
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("does not copy before xterm reports a selection change", () => {
		renderTerminal();
		const terminal = latestTerminal();

		terminal.setSelection("selected text");

		expect(writeClipboardTextMock).not.toHaveBeenCalled();
		expect(toasterCreateMock).not.toHaveBeenCalled();
	});

	it("copies the selected text and shows a toast after xterm reports a selection change", async () => {
		renderTerminal();
		const terminal = latestTerminal();

		terminal.setSelection("selected text");
		terminal.fireSelectionChange();

		await waitFor(() => {
			expect(writeClipboardTextMock).toHaveBeenCalledWith("selected text");
		});
		expect(toasterCreateMock).toHaveBeenCalledWith("Text copied");
	});

	it("does not copy empty selection", () => {
		renderTerminal();
		const terminal = latestTerminal();

		terminal.setSelection("");
		terminal.fireSelectionChange();

		expect(writeClipboardTextMock).not.toHaveBeenCalled();
		expect(toasterCreateMock).not.toHaveBeenCalled();
	});

	it("does not copy the same selection twice", async () => {
		renderTerminal();
		const terminal = latestTerminal();

		terminal.setSelection("selected text");
		terminal.fireSelectionChange();

		await waitFor(() => {
			expect(writeClipboardTextMock).toHaveBeenCalledTimes(1);
		});

		terminal.setSelection("selected text");
		terminal.fireSelectionChange();

		expect(writeClipboardTextMock).toHaveBeenCalledTimes(1);
		expect(toasterCreateMock).toHaveBeenCalledTimes(1);
	});

	it("publishes waiting status from an action-required title", async () => {
		renderTerminal();
		const terminal = latestTerminal();

		await waitFor(() => {
			expect(getPtySessionHistoryMock).toHaveBeenCalled();
		});
		terminal.fireTitleChange("Action Required");

		await waitFor(() => {
			expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
				"waiting",
			);
		});
	});

	it("keeps pending agent detection until the stream is ready", async () => {
		let resolveHistory: (value: number[]) => void = () => {};
		getPtySessionHistoryMock.mockReturnValueOnce(
			new Promise<number[]>((resolve) => {
				resolveHistory = resolve;
			}),
		);
		renderTerminal();
		const terminal = latestTerminal();

		terminal.fireTitleChange("Action Required");
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBeUndefined();

		resolveHistory([]);

		await waitFor(() => {
			expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
				"waiting",
			);
		});
	});

	it("streams Local PTY bytes and never opens a Herdr frame stream", async () => {
		renderTerminal();
		await waitFor(() => {
			expect(streamPtyOutput).toHaveBeenCalled();
		});
		expect(streamHerdrOutput).not.toHaveBeenCalled();
		expect(getPtySessionHistory).toHaveBeenCalled();
		expect(latestTerminal().csiHandlers).toEqual([]);
		latestTerminal().fireData("ls\n");
		expect(writeToPty).toHaveBeenCalledWith({
			sessionId: "session-1",
			data: "ls\n",
		});
	});
});

describe("herdr xterm transport", () => {
	beforeEach(() => {
		terminalInstances.length = 0;
		(getSessionBackend as unknown as Mock).mockReset();
		(getSessionBackend as unknown as Mock).mockResolvedValue("herdr");
		(streamHerdrOutput as unknown as Mock).mockReset();
		(streamHerdrOutput as unknown as Mock).mockResolvedValue(undefined);
		(streamPtyOutput as unknown as Mock).mockClear();
		(getPtySessionHistory as unknown as Mock).mockClear();
		(flushPtyOutput as unknown as Mock).mockClear();
		(detachPtyOutput as unknown as Mock).mockClear();
		(clearPtyOutput as unknown as Mock).mockClear();
		(writeToPty as unknown as Mock).mockClear();
		(listen as unknown as Mock).mockClear();
		useTerminalStore.setState({
			profiles: {
				"profile-1": {
					tabs: [{ id: "session-1", title: "Terminal 1" }],
					activeTabId: "session-1",
					counter: 1,
				},
			},
			agentStatuses: {},
			agentCompletions: {},
			sessionProfileIds: { "session-1": "profile-1" },
		});
		localStorage.clear();
		localStorage.setItem("terminal-buffer:session-1", "CACHED_SCROLLBACK");
	});

	afterEach(() => {
		cleanup();
	});

	async function renderHerdr(isActive = false) {
		const view = renderTerminal(isActive);
		await waitFor(() => {
			expect(streamHerdrOutput).toHaveBeenCalled();
		});
		return view;
	}

	it("streams Herdr frames only and skips Local history replay", async () => {
		await renderHerdr();
		expect(streamPtyOutput).not.toHaveBeenCalled();
		expect(getPtySessionHistory).not.toHaveBeenCalled();
		expect(flushPtyOutput).not.toHaveBeenCalled();
		expect(latestTerminal().writes).not.toContain("CACHED_SCROLLBACK");
		expect(listen).not.toHaveBeenCalledWith(
			"pty-exit-session-1",
			expect.any(Function),
		);
	});

	it("treats a verified full frame as a replacement surface", async () => {
		await renderHerdr();
		const terminal = latestTerminal();
		herdrChannel().onmessage(herdrFullRedrawFrame);
		expect(terminal.resetCount).toBe(1);
		expect(terminal.writes).toHaveLength(1);
		expect(terminal.writes[0]).toBeInstanceOf(Uint8Array);
		const text = latin1(terminal.writes[0] as Uint8Array);
		expect(text).toContain("\x1B[2J");
		expect(text).toContain("\x1B[?2026h");
	});

	it("appends a verified incremental frame and ignores stale seq", async () => {
		await renderHerdr();
		const terminal = latestTerminal();
		const full = herdrFullRedrawFrame;
		const incr = herdrIncrementalFrame;
		herdrChannel().onmessage(full);
		herdrChannel().onmessage(full);
		herdrChannel().onmessage(incr);
		herdrChannel().onmessage({ ...incr, seq: full.seq });
		expect(terminal.resetCount).toBe(1);
		expect(terminal.writes).toHaveLength(2);
		const incrText = latin1(terminal.writes[1] as Uint8Array);
		expect(incrText).toContain("INCR_LINE_XYZ");
		expect(incrText).not.toContain("\x1B[2J");
	});

	it("installs DSR/DA parser guards and still forwards keyboard input", async () => {
		await renderHerdr();
		const terminal = latestTerminal();
		expect(terminal.csiHandlers).toEqual(
			expect.arrayContaining([{ final: "n" }, { final: "c" }]),
		);
		terminal.fireData("echo hi\n");
		expect(writeToPty).toHaveBeenCalledWith({
			sessionId: "session-1",
			data: "echo hi\n",
		});
		terminal.fireBinary("\x80");
		expect(writeToPty).toHaveBeenCalledWith({
			sessionId: "session-1",
			data: "\x80",
		});
	});

	it("keeps the Herdr stream attached when the tab is hidden", async () => {
		const view = await renderHerdr(false);
		expect(detachPtyOutput).not.toHaveBeenCalled();
		view.rerender(
			<Terminal
				profileId="profile-1"
				sessionId="session-1"
				isActive={true}
			/>,
		);
		expect(detachPtyOutput).not.toHaveBeenCalled();
		expect(streamHerdrOutput).toHaveBeenCalledTimes(1);
		expect(terminalInstances).toHaveLength(1);
	});

	it("does not persist serialized scrollback onto a Herdr pane", async () => {
		const view = await renderHerdr();
		view.unmount();
		expect(localStorage.getItem("terminal-buffer:session-1")).toBe(
			"CACHED_SCROLLBACK",
		);
		expect(flushPtyOutput).not.toHaveBeenCalled();
		expect(clearPtyOutput).not.toHaveBeenCalled();
	});
});
