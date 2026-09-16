import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import type { HerdrTerminalFrame } from "@/generated";
import {
	attachPtyOutput,
	clearPtyOutput,
	detachPtyOutput,
	flushPtyOutput,
	getPtySessionHistory,
	getSessionAgentStatus,
	getSessionBackend,
	playSystemSound,
	resizePty,
	scrollPty,
	streamHerdrOutput,
	streamPtyOutput,
	streamSessionAgentStatus,
	writeToPty,
} from "@/generated";
import type { SessionAgentStatus } from "@/generated";
import { useNotificationStore } from "@/features/settings/stores/notificationStore";
import * as detector from "./detector";
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
	searchAddonMock,
	sendNotificationMock,
} = vi.hoisted(() => {
	interface MockTerminalInstance {
		element: HTMLElement | null;
		fireSelectionChange: () => void;
		fireTitleChange: (title: string) => void;
		fireKey: (event: {
			type: string;
			key: string;
			altKey?: boolean;
			ctrlKey?: boolean;
			metaKey?: boolean;
			shiftKey?: boolean;
			code?: string;
		}) => boolean | undefined;
		fireWheel: (event: { deltaY: number }) => boolean | undefined;
		setSelection: (selection: string) => void;
		writes: unknown[];
		resetCount: number;
		cols: number;
		rows: number;
		csiHandlers: Array<{ final: string }>;
		fireData: (data: string) => void;
		fireBinary: (data: string) => void;
		fireResize: () => void;
	}

	const terminalInstances: MockTerminalInstance[] = [];
	const writeClipboardTextMock = vi.fn();
	const readClipboardTextMock = vi.fn();
	const toasterCreateMock = vi.fn();
	const searchAddonMock = {
		findNext: vi.fn(),
		findPrevious: vi.fn(),
		clearDecorations: vi.fn(),
		onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
	};

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
		private resizeListeners: Array<(size: { rows: number; cols: number }) => void> =
			[];
		private keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
		private wheelHandler: ((event: WheelEvent) => boolean) | null = null;

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

		fireResize() {
			for (const listener of this.resizeListeners) {
				listener({ rows: this.rows, cols: this.cols });
			}
		}

		fireKey(event: {
			type: string;
			key: string;
			altKey?: boolean;
			ctrlKey?: boolean;
			metaKey?: boolean;
			shiftKey?: boolean;
			code?: string;
		}) {
			return this.keyHandler?.({
				type: event.type,
				key: event.key,
				code: event.code,
				altKey: event.altKey ?? false,
				ctrlKey: event.ctrlKey ?? false,
				metaKey: event.metaKey ?? false,
				shiftKey: event.shiftKey ?? false,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
			} as unknown as KeyboardEvent);
		}

		fireWheel(event: { deltaY: number }) {
			return this.wheelHandler?.({
				deltaY: event.deltaY,
				deltaMode: 0,
				preventDefault: vi.fn(),
				stopPropagation: vi.fn(),
				defaultPrevented: false,
			} as unknown as WheelEvent);
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

		onResize(listener: (size: { rows: number; cols: number }) => void) {
			this.resizeListeners.push(listener);
			return { dispose: vi.fn() };
		}

		attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
			this.keyHandler = handler;
		}

		attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean) {
			this.wheelHandler = handler;
		}

		registerLinkProvider() {
			return { dispose: vi.fn() };
		}
	}

	return {
		readClipboardTextMock,
		searchAddonMock,
		sendNotificationMock: vi.fn(),
		terminalInstances,
		toasterCreateMock,
		writeClipboardTextMock,
		TerminalMock: MockTerminal,
	};
});

vi.mock("@xterm/xterm", () => ({
	Terminal: TerminalMock,
}));

vi.mock("./detector", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./detector")>();
	return {
		...actual,
		createAgentStatusDetector: vi.fn(() =>
			actual.createAgentStatusDetector(),
		),
	};
});

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
	readText: readClipboardTextMock,
	writeText: writeClipboardTextMock,
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
	open: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
	isPermissionGranted: vi.fn(() => Promise.resolve(true)),
	sendNotification: sendNotificationMock,
}));

vi.mock("@/generated", () => ({
	attachPtyOutput: vi.fn(() => Promise.resolve()),
	clearPtyOutput: vi.fn(() => Promise.resolve()),
	detachPtyOutput: vi.fn(() => Promise.resolve()),
	flushPtyOutput: vi.fn(() => Promise.resolve()),
	getPtySessionHistory: vi.fn(() => Promise.resolve([])),
	getSessionAgentStatus: vi.fn(() => Promise.resolve(null)),
	getSessionBackend: vi.fn(() => Promise.resolve("local")),
	listProjectSessions: vi.fn(() => Promise.resolve([])),
	listProjects: vi.fn(() => Promise.resolve([])),
	playSystemSound: vi.fn(() => Promise.resolve()),
	resizePty: vi.fn(() => Promise.resolve()),
	restorePtySession: vi.fn(() =>
		Promise.resolve({ newSessionId: "mock-session-id", history: [] }),
	),
	scrollPty: vi.fn(() => Promise.resolve()),
	streamHerdrOutput: vi.fn(() => Promise.resolve()),
	streamPtyOutput: vi.fn(() => Promise.resolve()),
	streamSessionAgentStatus: vi.fn(() => Promise.resolve()),
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
		searchAddon: searchAddonMock,
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

function herdrAgentChannel() {
	const call = (streamSessionAgentStatus as unknown as Mock).mock.calls[0] as
		| [{ onUpdate: { onmessage: (dto: SessionAgentStatus) => void } }]
		| undefined;
	expect(call).toBeDefined();
	return call![0].onUpdate;
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
		(getSessionAgentStatus as unknown as Mock).mockReset();
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue(null);
		(streamSessionAgentStatus as unknown as Mock).mockReset();
		(streamSessionAgentStatus as unknown as Mock).mockResolvedValue(
			undefined,
		);
		vi.mocked(detector.createAgentStatusDetector).mockClear();
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
		expect(detector.createAgentStatusDetector).toHaveBeenCalled();
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
		expect(getSessionAgentStatus).not.toHaveBeenCalled();
		expect(streamSessionAgentStatus).not.toHaveBeenCalled();
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
		(resizePty as unknown as Mock).mockClear();
		(attachPtyOutput as unknown as Mock).mockClear();
		(attachPtyOutput as unknown as Mock).mockResolvedValue(undefined);
		(scrollPty as unknown as Mock).mockReset();
		(scrollPty as unknown as Mock).mockResolvedValue(undefined);
		(getSessionAgentStatus as unknown as Mock).mockReset();
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue({
			sessionId: "session-1",
			status: "unknown",
			agentName: null,
		} satisfies SessionAgentStatus);
		(streamSessionAgentStatus as unknown as Mock).mockReset();
		(streamSessionAgentStatus as unknown as Mock).mockResolvedValue(
			undefined,
		);
		(playSystemSound as unknown as Mock).mockReset();
		sendNotificationMock.mockReset();
		vi.mocked(detector.createAgentStatusDetector).mockClear();
		useNotificationStore.setState({ enabled: false, sound: "Ping" });
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		searchAddonMock.findNext.mockReset();
		searchAddonMock.findPrevious.mockReset();
		searchAddonMock.clearDecorations.mockReset();
		searchAddonMock.onDidChangeResults.mockReset();
		searchAddonMock.onDidChangeResults.mockReturnValue({ dispose: vi.fn() });
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
			expect(streamSessionAgentStatus).toHaveBeenCalled();
		});
		return view;
	}

	it("resizes a Herdr session only after the control helper is attached", async () => {
		let resolveAttach: (value: void | PromiseLike<void>) => void = () => {};
		(attachPtyOutput as unknown as Mock).mockReturnValueOnce(
			new Promise<void>((resolve) => {
				resolveAttach = resolve;
			}),
		);

		renderTerminal();
		const terminal = latestTerminal();
		terminal.fireResize();
		expect(resizePty).not.toHaveBeenCalled();

		await waitFor(() => {
			expect(attachPtyOutput).toHaveBeenCalled();
		});
		terminal.fireResize();
		expect(resizePty).not.toHaveBeenCalled();
		expect(streamHerdrOutput).not.toHaveBeenCalled();

		resolveAttach();

		await waitFor(() => {
			expect(resizePty).toHaveBeenCalledWith({
				sessionId: "session-1",
				rows: terminal.rows,
				cols: terminal.cols,
			});
		});
		const attachOrder = (attachPtyOutput as unknown as Mock).mock
			.invocationCallOrder[0];
		const resizeOrder = (resizePty as unknown as Mock).mock
			.invocationCallOrder[0];
		expect(attachOrder).toBeLessThan(resizeOrder);
		expect(streamHerdrOutput).toHaveBeenCalled();
	});

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

	it("scrolls the attached Herdr pane with wheel and page keys", async () => {
		const { container } = await renderHerdr();
		const wrapper = latestTerminal().element;
		expect(wrapper).toBeTruthy();
		fireEvent.wheel(wrapper!, { deltaY: -80 });
		expect(scrollPty).toHaveBeenCalledWith({
			sessionId: "session-1",
			direction: "up",
			lines: 2,
			source: "wheel",
		});

		latestTerminal().fireKey({ type: "keydown", key: "PageDown" });
		expect(scrollPty).toHaveBeenCalledWith({
			sessionId: "session-1",
			direction: "down",
			lines: latestTerminal().rows,
			source: "pageKey",
		});
		expect(container.querySelector(".xterm")).toBeNull();
	});

	it("scrolls Herdr from xterm's inner viewport before local scrollback consumes the wheel", async () => {
		await renderHerdr();
		const wrapper = latestTerminal().element;
		expect(wrapper).toBeTruthy();

		const viewport = document.createElement("div");
		viewport.className = "xterm-viewport";
		wrapper!.appendChild(viewport);

		const consumeWheel = vi.fn((event: Event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		viewport.addEventListener("wheel", consumeWheel, { passive: false });

		fireEvent.wheel(viewport, { deltaY: -80 });

		expect(scrollPty).toHaveBeenCalledWith({
			sessionId: "session-1",
			direction: "up",
			lines: 2,
			source: "wheel",
		});
		expect(consumeWheel).not.toHaveBeenCalled();
		expect(latestTerminal().fireWheel({ deltaY: -80 })).toBe(false);
	});

	it("searches applied frames with the xterm SearchAddon", async () => {
		await renderHerdr();
		herdrChannel().onmessage(herdrFullRedrawFrame);
		latestTerminal().fireKey({
			type: "keydown",
			key: "f",
			ctrlKey: true,
			shiftKey: true,
		});
		const input = await screen.findByRole("textbox");
		fireEvent.change(input, { target: { value: "SCR01" } });
		expect(searchAddonMock.findNext).toHaveBeenCalledWith(
			"SCR01",
			expect.objectContaining({ incremental: true }),
		);
		expect(getPtySessionHistory).not.toHaveBeenCalled();
	});

	it("does not construct the local detector or parse OSC for lifecycle", async () => {
		await renderHerdr();
		expect(detector.createAgentStatusDetector).not.toHaveBeenCalled();
		latestTerminal().fireTitleChange("Action Required");
		await Promise.resolve();
		expect(
			useTerminalStore.getState().agentStatuses["session-1"],
		).toBeUndefined();
	});

	it("publishes waiting from projected blocked status once when unfocused", async () => {
		useNotificationStore.setState({ enabled: true, sound: "Ping" });
		vi.spyOn(document, "hasFocus").mockReturnValue(false);
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue({
			sessionId: "session-1",
			status: "blocked",
			agentName: "Claude Code",
		} satisfies SessionAgentStatus);
		await renderHerdr();
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
			"waiting",
		);
		await waitFor(() => {
			expect(sendNotificationMock).toHaveBeenCalledTimes(1);
		});
		expect(playSystemSound).toHaveBeenCalledTimes(1);
		herdrAgentChannel().onmessage({
			sessionId: "session-1",
			status: "blocked",
			agentName: "Claude Code",
		});
		expect(sendNotificationMock).toHaveBeenCalledTimes(1);
		expect(playSystemSound).toHaveBeenCalledTimes(1);
	});

	it("does not re-notify a still-blocked pane after reconnect hydrate", async () => {
		useNotificationStore.setState({ enabled: true, sound: "Ping" });
		vi.spyOn(document, "hasFocus").mockReturnValue(false);
		useTerminalStore.setState({
			agentStatuses: { "session-1": "waiting" },
		});
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue({
			sessionId: "session-1",
			status: "blocked",
			agentName: "Claude Code",
		} satisfies SessionAgentStatus);
		await renderHerdr();
		herdrAgentChannel().onmessage({
			sessionId: "session-1",
			status: "blocked",
			agentName: "Claude Code",
		});
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
			"waiting",
		);
		expect(sendNotificationMock).not.toHaveBeenCalled();
		expect(playSystemSound).not.toHaveBeenCalled();
	});

	it("creates a completion once from running to done and keeps a dismissed one gone", async () => {
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue({
			sessionId: "session-1",
			status: "working",
			agentName: "Claude Code",
		} satisfies SessionAgentStatus);
		await renderHerdr();
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
			"running",
		);
		herdrAgentChannel().onmessage({
			sessionId: "session-1",
			status: "done",
			agentName: "Claude Code",
		});
		expect(
			useTerminalStore.getState().agentStatuses["session-1"],
		).toBeUndefined();
		expect(useTerminalStore.getState().agentCompletions["session-1"]).toBe(
			"completed",
		);
		useTerminalStore.getState().dismissAgentCompletion("session-1");
		herdrAgentChannel().onmessage({
			sessionId: "session-1",
			status: "done",
			agentName: "Claude Code",
		});
		expect(
			useTerminalStore.getState().agentCompletions["session-1"],
		).toBeUndefined();
	});

	it("does not create a completion when blocked becomes idle", async () => {
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue({
			sessionId: "session-1",
			status: "blocked",
			agentName: "Claude Code",
		} satisfies SessionAgentStatus);
		await renderHerdr();
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
			"waiting",
		);
		herdrAgentChannel().onmessage({
			sessionId: "session-1",
			status: "idle",
			agentName: "Claude Code",
		});
		expect(
			useTerminalStore.getState().agentStatuses["session-1"],
		).toBeUndefined();
		expect(
			useTerminalStore.getState().agentCompletions["session-1"],
		).toBeUndefined();
	});

	it("clears a live waiting badge when the stream fail-closes to unknown", async () => {
		(getSessionAgentStatus as unknown as Mock).mockResolvedValue({
			sessionId: "session-1",
			status: "blocked",
			agentName: "Claude Code",
		} satisfies SessionAgentStatus);
		await renderHerdr();
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
			"waiting",
		);
		herdrAgentChannel().onmessage({
			sessionId: "session-1",
			status: "unknown",
			agentName: null,
		});
		expect(
			useTerminalStore.getState().agentStatuses["session-1"],
		).toBeUndefined();
		expect(
			useTerminalStore.getState().agentCompletions["session-1"],
		).toBeUndefined();
	});
});
