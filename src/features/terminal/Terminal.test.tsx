import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "./Terminal";

const {
	readClipboardTextMock,
	TerminalMock,
	terminalInstances,
	toasterCreateMock,
	writeClipboardTextMock,
} = vi.hoisted(() => {
	interface MockTerminalInstance {
		fireSelectionChange: () => void;
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
		private selection = "";
		private selectionListeners: Array<() => void> = [];

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

		onSelectionChange(listener: () => void) {
			this.selectionListeners.push(listener);
			return { dispose: vi.fn() };
		}

		onTitleChange() {
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
	detachPtyOutput: vi.fn(() => Promise.resolve()),
	clearPtyOutput: vi.fn(() => Promise.resolve()),
	flushPtyOutput: vi.fn(() => Promise.resolve()),
	getPtySessionHistory: vi.fn(() => Promise.resolve([])),
	listProjectSessions: vi.fn(() => Promise.resolve([])),
	listProjects: vi.fn(() => Promise.resolve([])),
	resizePty: vi.fn(() => Promise.resolve()),
	restorePtySession: vi.fn(() =>
		Promise.resolve({ newSessionId: "mock-session-id", history: [] }),
	),
	writeToPty: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/shared/providers/appToaster", () => ({
	toaster: {
		create: toasterCreateMock,
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
	getTerminalParkingContainer: () => document.body,
	installImagePasteFallback: () => vi.fn(),
	loadAddons: () => ({
		fitAddon: { fit: vi.fn() },
		serializeAddon: { serialize: vi.fn(() => "") },
		dispose: vi.fn(),
	}),
	measureAndResize: vi.fn(() => false),
	scheduleFontSettleRefit: vi.fn(),
	suppressQueryResponses: () => vi.fn(),
	TitleDebouncer: class {
		value = "";
		set(value: string) {
			this.value = value;
		}
		subscribe() {}
		dispose() {}
	},
}));

function renderTerminal() {
	render(<Terminal profileId="profile-1" sessionId="session-1" isActive={false} />);
	return terminalInstances[terminalInstances.length - 1];
}

describe("terminal select to copy", () => {
	beforeEach(() => {
		terminalInstances.length = 0;
		writeClipboardTextMock.mockReset();
		writeClipboardTextMock.mockResolvedValue(undefined);
		readClipboardTextMock.mockReset();
		toasterCreateMock.mockReset();
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
		expect(toasterCreateMock).toHaveBeenCalledWith({
			title: "Text copied",
			type: "success",
			closable: true,
		});
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
});
