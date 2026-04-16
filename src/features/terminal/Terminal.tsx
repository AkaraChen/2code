import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import type { TerminalHandle } from "@wterm/react";
import { Terminal as WTermTerminal } from "@wterm/react";
import consola from "consola";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	clearPtyOutput,
	flushPtyOutput,
	resizePty,
	writeToPty,
} from "@/generated";
import { TerminalLinkConfirmDialog } from "./TerminalLinkConfirmDialog";
import { useTerminalTheme } from "./hooks";
import { getTerminalShortcutAction } from "./keybindings";
import { shouldBypassTerminalLinkConfirm } from "./linkOpening";
import { sessionHistory } from "./state";
import { useTerminalStore } from "./store";
import "@wterm/react/css";
import "./terminal.css";

interface TerminalProps {
	profileId: string;
	sessionId: string;
	isActive: boolean;
}

type TerminalStyle = CSSProperties & Record<`--${string}`, string | number>;

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_URI_PUNCTUATION_PATTERN = /[),.;:!?]+$/u;

function getTerminalRowHeight(fontSize: number) {
	return Math.max(16, Math.round(fontSize * 1.3));
}

function trimTerminalUri(uri: string) {
	return uri.replace(TRAILING_URI_PUNCTUATION_PATTERN, "");
}

function getCaretPositionFromPoint(x: number, y: number) {
	if ("caretPositionFromPoint" in document) {
		const position = document.caretPositionFromPoint(x, y);
		if (position) {
			return {
				node: position.offsetNode,
				offset: position.offset,
			};
		}
	}

	if ("caretRangeFromPoint" in document) {
		const range = document.caretRangeFromPoint?.(x, y);
		if (range) {
			return {
				node: range.startContainer,
				offset: range.startOffset,
			};
		}
	}

	return null;
}

function findTextOffsetInRow(
	row: HTMLElement,
	targetNode: Node,
	targetOffset: number,
) {
	const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
	let offset = 0;

	while (walker.nextNode()) {
		const current = walker.currentNode;
		const text = current.textContent ?? "";
		if (current === targetNode) {
			return offset + Math.min(targetOffset, text.length);
		}
		offset += text.length;
	}

	return null;
}

function findUriAtOffset(text: string, offset: number) {
	for (const match of text.matchAll(URL_PATTERN)) {
		const index = match.index ?? -1;
		const value = trimTerminalUri(match[0]);
		if (offset >= index && offset <= index + value.length) {
			return value;
		}
	}

	return null;
}

function findTerminalUriFromClick(
	event: MouseEvent,
	root: HTMLDivElement,
) {
	const selection = window.getSelection();
	if (selection && !selection.isCollapsed) return null;

	const caret = getCaretPositionFromPoint(event.clientX, event.clientY);
	if (!caret) return null;

	const row =
		caret.node instanceof Element
			? caret.node.closest<HTMLElement>(".term-row")
			: caret.node.parentElement?.closest<HTMLElement>(".term-row");
	if (!row || !root.contains(row)) return null;

	const offset = findTextOffsetInRow(row, caret.node, caret.offset);
	if (offset == null) return null;

	return findUriAtOffset(row.textContent ?? "", offset);
}

function measureTerminalCellWidth(
	container: HTMLDivElement,
	fontFamily: string,
	fontSize: number,
) {
	const probe = document.createElement("span");
	probe.textContent = "W";
	probe.style.position = "absolute";
	probe.style.visibility = "hidden";
	probe.style.pointerEvents = "none";
	probe.style.whiteSpace = "pre";
	probe.style.fontFamily = `"${fontFamily}", monospace`;
	probe.style.fontSize = `${fontSize}px`;
	container.appendChild(probe);
	const width = probe.getBoundingClientRect().width;
	probe.remove();

	return width > 0 ? width : null;
}

export function Terminal({ profileId, sessionId, isActive }: TerminalProps) {
	const terminalRef = useRef<TerminalHandle | null>(null);
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const isStreamReadyRef = useRef(false);
	const pendingEventsRef = useRef<string[]>([]);
	const layoutFrameRef = useRef<number | null>(null);
	const disposedRef = useRef(false);
	const [pendingLink, setPendingLink] = useState<string | null>(null);
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const increaseFontSize = useTerminalSettingsStore(
		(s) => s.increaseFontSize,
	);
	const decreaseFontSize = useTerminalSettingsStore(
		(s) => s.decreaseFontSize,
	);
	const theme = useTerminalTheme();
	const terminalRowHeight = useMemo(
		() => getTerminalRowHeight(fontSize),
		[fontSize],
	);

	const syncTerminalLayout = useCallback(
		(delayFrames = 0) => {
			if (layoutFrameRef.current !== null) {
				window.cancelAnimationFrame(layoutFrameRef.current);
			}

			let remainingFrames = delayFrames;
			const tick = () => {
				if (remainingFrames > 0) {
					remainingFrames -= 1;
					layoutFrameRef.current = window.requestAnimationFrame(tick);
					return;
				}

				layoutFrameRef.current = null;

				const viewport = viewportRef.current;
				const terminal = terminalRef.current;
				const instance = terminal?.instance;
				if (!viewport || !terminal || !instance) return;

				const rect = viewport.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;

				const cellWidth = measureTerminalCellWidth(
					viewport,
					fontFamily,
					fontSize,
				);
				if (!cellWidth) return;

				const cols = Math.max(1, Math.floor(rect.width / cellWidth));
				const rows = Math.max(
					1,
					Math.floor(rect.height / terminalRowHeight),
				);
				if (cols !== instance.cols || rows !== instance.rows) {
					terminal.resize(cols, rows);
				}
			};

			layoutFrameRef.current = window.requestAnimationFrame(tick);
		},
		[fontFamily, fontSize, terminalRowHeight],
	);

	useEffect(() => {
		disposedRef.current = false;
		const unlisteners: UnlistenFn[] = [];
		let listenersDisposed = false;

		consola.info(`[pty-terminal] mount sessionId=${sessionId}`);

		async function setupListeners() {
			const unlistenOutput = await listen<string>(
				`pty-output-${sessionId}`,
				(event) => {
					if (!isStreamReadyRef.current) {
						pendingEventsRef.current.push(event.payload);
						return;
					}
					terminalRef.current?.write(event.payload);
				},
			);
			const unlistenExit = await listen(`pty-exit-${sessionId}`, () => {
				terminalRef.current?.write(
					"\r\n\x1B[90m[Process exited]\x1B[0m\r\n",
				);
			});

			if (listenersDisposed || disposedRef.current) {
				unlistenOutput();
				unlistenExit();
				return;
			}

			unlisteners.push(unlistenOutput, unlistenExit);
			consola.info(
				`[pty-terminal] live listeners registered for session ${sessionId}`,
			);
		}

		void setupListeners();

		return () => {
			disposedRef.current = true;
			listenersDisposed = true;
			consola.info(`[pty-terminal] unmount sessionId=${sessionId}`);

			void flushPtyOutput({ sessionId }).catch(() => {});

			isStreamReadyRef.current = false;
			pendingEventsRef.current = [];

			if (layoutFrameRef.current !== null) {
				window.cancelAnimationFrame(layoutFrameRef.current);
				layoutFrameRef.current = null;
			}

			for (const unlisten of unlisteners) {
				unlisten();
			}

			terminalRef.current = null;
		};
	}, [sessionId]);

	useEffect(() => {
		syncTerminalLayout();
	}, [syncTerminalLayout, theme]);

	useEffect(() => {
		syncTerminalLayout(1);

		if (!("fonts" in document)) return;

		let cancelled = false;
		void Promise.allSettled([
			document.fonts.load(`${fontSize}px "${fontFamily}"`),
			document.fonts.ready,
		]).then(() => {
			if (!cancelled) {
				syncTerminalLayout(1);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [fontFamily, fontSize, syncTerminalLayout]);

	useEffect(() => {
		if (!isActive) return;

		syncTerminalLayout(2);
		const focusFrame = window.requestAnimationFrame(() => {
			terminalRef.current?.focus();
		});

		return () => {
			window.cancelAnimationFrame(focusFrame);
		};
	}, [isActive, syncTerminalLayout]);

	const shellStyle = useMemo(
		() => ({
			display: "flex",
			width: "100%",
			height: "100%",
			padding: "8px 0 0 8px",
			background: theme.background,
			border: "0.5px solid var(--chakra-colors-border-subtle)",
			boxSizing: "border-box" as const,
			overflow: "hidden",
		}),
		[theme.background],
	);

	const terminalStyle = useMemo<TerminalStyle>(
		() => ({
			width: "100%",
			height: "100%",
			padding: 0,
			borderRadius: 0,
			boxShadow: "none",
			overflow: "auto",
			"--term-bg": theme.background,
			"--term-fg": theme.foreground,
			"--term-cursor": theme.cursor,
			"--term-selection-bg": theme.selectionBackground,
			"--term-font-family": `"${fontFamily}", monospace`,
			"--term-font-size": `${fontSize}px`,
			"--term-line-height": 1.2,
			"--term-row-height": `${terminalRowHeight}px`,
			"--term-color-0": theme.black,
			"--term-color-1": theme.red,
			"--term-color-2": theme.green,
			"--term-color-3": theme.yellow,
			"--term-color-4": theme.blue,
			"--term-color-5": theme.magenta,
			"--term-color-6": theme.cyan,
			"--term-color-7": theme.white,
			"--term-color-8": theme.brightBlack,
			"--term-color-9": theme.brightRed,
			"--term-color-10": theme.brightGreen,
			"--term-color-11": theme.brightYellow,
			"--term-color-12": theme.brightBlue,
			"--term-color-13": theme.brightMagenta,
			"--term-color-14": theme.brightCyan,
			"--term-color-15": theme.brightWhite,
		}),
		[fontFamily, fontSize, terminalRowHeight, theme],
	);

	const closePendingLinkDialog = useCallback(() => {
		setPendingLink(null);
	}, []);

	const openPendingLink = useCallback(() => {
		const uri = pendingLink;
		if (!uri) return;

		setPendingLink(null);
		void open(uri);
	}, [pendingLink]);

	const handleTerminalReady = useCallback(() => {
		if (disposedRef.current) return;

		const terminal = terminalRef.current;
		if (!terminal) return;

		const history = sessionHistory.get(sessionId);
		if (history && history.length > 0) {
			consola.info(
				`[pty-restore] writing ${history.length} bytes of history for session ${sessionId}`,
			);
			terminal.write(history);
			sessionHistory.delete(sessionId);
		}

		isStreamReadyRef.current = true;
		for (const payload of pendingEventsRef.current) {
			terminal.write(payload);
		}
		pendingEventsRef.current = [];

		syncTerminalLayout(1);
		if (isActive) {
			terminal.focus();
		}
	}, [isActive, sessionId, syncTerminalLayout]);

	const handleTerminalData = useCallback(
		(data: string) => {
			void writeToPty({ sessionId, data });
		},
		[sessionId],
	);

	const handleTerminalResize = useCallback(
		(cols: number, rows: number) => {
			void resizePty({ sessionId, rows, cols });
		},
		[sessionId],
	);

	const handleTerminalTitle = useCallback(
		(title: string) => {
			useTerminalStore
				.getState()
				.updateTabTitle(profileId, sessionId, title);
		},
		[profileId, sessionId],
	);

	const handleTerminalError = useCallback(
		(error: unknown) => {
			consola.error(
				`[pty-terminal] init failed for session ${sessionId}`,
				error,
			);
		},
		[sessionId],
	);

	const handleTerminalKeyDownCapture = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			const action = getTerminalShortcutAction(event.nativeEvent);
			if (!action) return;

			event.preventDefault();
			event.stopPropagation();

			if (action.type === "increase-font-size") {
				increaseFontSize();
				return;
			}

			if (action.type === "decrease-font-size") {
				decreaseFontSize();
				return;
			}

			if (action.type === "clear-screen") {
				void clearPtyOutput({ sessionId })
					.catch(() => {})
					.finally(() => {
						void writeToPty({ sessionId, data: "\x0C" });
					});
				return;
			}

			void writeToPty({ sessionId, data: action.sequence });
		},
		[
			decreaseFontSize,
			increaseFontSize,
			sessionId,
		],
	);

	const handleTerminalClick = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const uri = findTerminalUriFromClick(
				event.nativeEvent,
				event.currentTarget,
			);
			if (!uri) return;

			event.preventDefault();
			event.stopPropagation();

			if (shouldBypassTerminalLinkConfirm(event.nativeEvent)) {
				void open(uri);
				return;
			}

			setPendingLink(uri);
		},
		[],
	);

	return (
		<>
			<div style={shellStyle}>
				<div
					ref={viewportRef}
					style={{ flex: 1, minWidth: 0, minHeight: 0 }}
				>
					<WTermTerminal
						ref={terminalRef}
						autoResize
						cursorBlink
						className="code-terminal"
						style={terminalStyle}
						onData={handleTerminalData}
						onResize={handleTerminalResize}
						onTitle={handleTerminalTitle}
						onReady={handleTerminalReady}
						onError={handleTerminalError}
						onKeyDownCapture={handleTerminalKeyDownCapture}
						onClick={handleTerminalClick}
					/>
				</div>
			</div>

			<TerminalLinkConfirmDialog
				link={pendingLink}
				onClose={closePendingLinkDialog}
				onOpen={openPendingLink}
			/>
		</>
	);
}
