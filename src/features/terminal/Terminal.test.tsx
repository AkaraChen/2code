import { cleanup, render, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPtySessionHistory } from "./ptyHistoryIpc";
import { Terminal } from "./Terminal";
import { useTerminalStore } from "./store";

const {
	readClipboardTextMock,
	TerminalMock,
	terminalInstances,
	toasterCreateMock,
	writeClipboardTextMock,
} = vi.hoisted(() => {
	interface MockTerminalInstance {
		dispose: Mock;
		element: HTMLElement | null;
		fireSelectionChange: () => void;
		fireTitleChange: (title: string) => void;
		setSelection: (selection: string) => void;
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
		buffer = {
			active: {
				length: 0,
				getLine: () => undefined,
			},
		};
		dispose = vi.fn();
		private selection = "";
		private selectionListeners: Array<() => void> = [];
		private titleListeners: Array<(title: string) => void> = [];

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
		write(_data: unknown, callback?: () => void) {
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

		onSelectionChange(listener: () => void) {
			this.selectionListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onTitleChange(listener: (title: string) => void) {
			this.titleListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onData() {
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
	listProjectSessions: vi.fn(() => Promise.resolve([])),
	listProjects: vi.fn(() => Promise.resolve([])),
	playSystemSound: vi.fn(() => Promise.resolve()),
	resizePty: vi.fn(() => Promise.resolve()),
	restorePtySession: vi.fn(() =>
		Promise.resolve({ newSessionId: "mock-session-id", historyLen: 0 }),
	),
	streamPtyOutput: vi.fn(() => Promise.resolve()),
	writeToPty: vi.fn(() => Promise.resolve()),
}));

vi.mock("./ptyHistoryIpc", () => ({
	fetchPtySessionHistory: vi.fn(() => Promise.resolve(new Uint8Array())),
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
	createResizeScheduler: () => ({
		observe: vi.fn(),
		dispose: vi.fn(),
	}),
	createTerminalKeyEventHandler: () => () => true,
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

function renderTerminal() {
	render(<Terminal profileId="profile-1" sessionId="session-1" isActive={false} />);
	return terminalInstances[terminalInstances.length - 1];
}

describe("terminal select to copy", () => {
	const fetchPtySessionHistoryMock = fetchPtySessionHistory as unknown as Mock;

	beforeEach(() => {
		terminalInstances.length = 0;
		writeClipboardTextMock.mockReset();
		writeClipboardTextMock.mockResolvedValue(undefined);
		readClipboardTextMock.mockReset();
		toasterCreateMock.mockReset();
		fetchPtySessionHistoryMock.mockClear();
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
		const terminal = renderTerminal();

		terminal.setSelection("selected text");

		expect(writeClipboardTextMock).not.toHaveBeenCalled();
		expect(toasterCreateMock).not.toHaveBeenCalled();
	});

	it("copies the selected text and shows a toast after xterm reports a selection change", async () => {
		const terminal = renderTerminal();

		terminal.setSelection("selected text");
		terminal.fireSelectionChange();

		await waitFor(() => {
			expect(writeClipboardTextMock).toHaveBeenCalledWith("selected text");
		});
		expect(toasterCreateMock).toHaveBeenCalledWith("Text copied");
	});

	it("does not copy empty selection", () => {
		const terminal = renderTerminal();

		terminal.setSelection("");
		terminal.fireSelectionChange();

		expect(writeClipboardTextMock).not.toHaveBeenCalled();
		expect(toasterCreateMock).not.toHaveBeenCalled();
	});

	it("does not copy the same selection twice", async () => {
		const terminal = renderTerminal();

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

	it("disposes xterm and removes its wrapper on unmount while the tab is still open", () => {
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

		const { unmount } = render(
			<Terminal profileId="profile-1" sessionId="session-1" isActive={false} />,
		);
		const terminal = terminalInstances[terminalInstances.length - 1];

		expect(terminal.element?.isConnected).toBe(true);

		unmount();

		expect(terminal.dispose).toHaveBeenCalledTimes(1);
		expect(terminal.element?.isConnected).toBe(false);
		expect(document.getElementById("terminal-parking")).toBeNull();
	});

	it("publishes waiting status from an action-required title", async () => {
		const terminal = renderTerminal();

		await waitFor(() => {
			expect(fetchPtySessionHistoryMock).toHaveBeenCalled();
		});
		terminal.fireTitleChange("Action Required");

		await waitFor(() => {
			expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
				"waiting",
			);
		});
	});

	it("keeps pending agent detection until the stream is ready", async () => {
		let resolveHistory: (value: Uint8Array) => void = () => {};
		fetchPtySessionHistoryMock.mockReturnValueOnce(
			new Promise<Uint8Array>((resolve) => {
				resolveHistory = resolve;
			}),
		);
		const terminal = renderTerminal();

		terminal.fireTitleChange("Action Required");
		expect(useTerminalStore.getState().agentStatuses["session-1"]).toBeUndefined();

		resolveHistory(new Uint8Array());

		await waitFor(() => {
			expect(useTerminalStore.getState().agentStatuses["session-1"]).toBe(
				"waiting",
			);
		});
	});
});
