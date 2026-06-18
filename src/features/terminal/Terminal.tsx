import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
	readText as readClipboardText,
	writeText as writeClipboardText,
} from "@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as XTerm } from "@xterm/xterm";
import consola from "consola";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	clearPtyOutput,
	flushPtyOutput,
	getPtySessionHistory,
	resizePty,
	writeToPty,
} from "@/generated";
import { FileLinkProvider } from "./FileLinkProvider";
import { TerminalLinkConfirmDialog } from "./TerminalLinkConfirmDialog";
import { useTerminalTheme } from "./hooks";
import { getTerminalShortcutAction } from "./keybindings";
import { shouldBypassTerminalLinkConfirm } from "./linkOpening";
import { getSuffixPrefixOverlapLength } from "./overlap";
import { sessionHistory } from "./state";
import { useTerminalStore } from "./store";
import {
	applyTerminalFontFamilyCssVariable,
	buildFontFamilyCss,
	createResizeScheduler,
	createTerminalKeyEventHandler,
	getTerminalParkingContainer,
	installImagePasteFallback,
	loadAddons,
	measureAndResize,
	scheduleFontSettleRefit,
	suppressQueryResponses,
	TitleDebouncer,
} from "./lib";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_SCROLLBACK = 5000;
const SERIALIZE_SCROLLBACK = 1000;
const BUFFER_STORAGE_PREFIX = "terminal-buffer:";
const DIMS_STORAGE_PREFIX = "terminal-dims:";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;

function loadSavedDimensions(sessionId: string): { cols: number; rows: number } | null {
	try {
		const raw = localStorage.getItem(`${DIMS_STORAGE_PREFIX}${sessionId}`);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (typeof parsed.cols === "number" && typeof parsed.rows === "number") {
			return parsed;
		}
		return null;
	} catch {
		return null;
	}
}

function persistDimensions(sessionId: string, cols: number, rows: number): void {
	try {
		localStorage.setItem(
			`${DIMS_STORAGE_PREFIX}${sessionId}`,
			JSON.stringify({ cols, rows }),
		);
	} catch {}
}

function persistBuffer(sessionId: string, serializeAddon: SerializeAddon): void {
	try {
		const data = serializeAddon.serialize({ scrollback: SERIALIZE_SCROLLBACK });
		localStorage.setItem(`${BUFFER_STORAGE_PREFIX}${sessionId}`, data);
	} catch {}
}

function restoreBuffer(sessionId: string, terminal: XTerm): void {
	try {
		const data = localStorage.getItem(`${BUFFER_STORAGE_PREFIX}${sessionId}`);
		if (data) terminal.write(data);
	} catch {}
}

interface TerminalProps {
	profileId: string;
	sessionId: string;
	isActive: boolean;
}

export function Terminal({ profileId, sessionId, isActive }: TerminalProps) {
	const termRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<ReturnType<typeof loadAddons>["fitAddon"] | null>(null);
	const serializeAddonRef = useRef<SerializeAddon | null>(null);
	const webglAddonRef = useRef<(() => import("@xterm/addon-webgl").WebglAddon | null) | null>(null);
	const isStreamReadyRef = useRef(false);
	const pendingEventsRef = useRef<string[]>([]);
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

	const initFontFamilyRef = useRef(fontFamily);
	const initFontSizeRef = useRef(fontSize);
	const initThemeRef = useRef(theme);

	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.theme = theme;
		}
	}, [theme]);

	useEffect(() => {
		const term = termRef.current;
		const fitAddon = fitAddonRef.current;
		if (!term || !fitAddon) return;

		const sanitizedFont = buildFontFamilyCss(fontFamily);
		term.options.fontFamily = sanitizedFont;
		term.options.fontSize = fontSize;
		applyTerminalFontFamilyCssVariable(
			(term as unknown as { _wrapper?: HTMLElement })._wrapper ?? term.element ?? document.body,
			sanitizedFont,
		);

		// WebGL renderer caches glyphs in a texture atlas. Changing fontFamily
		// doesn't invalidate the atlas, so the old font's glyphs keep rendering.
		// Clear the atlas + force a full repaint so the new font is picked up.
		const webgl = webglAddonRef.current?.();
		if (webgl) {
			try {
				webgl.clearTextureAtlas();
			} catch {}
		}
		term.refresh(0, Math.max(0, term.rows - 1));

		// Refit immediately if visible
		measureAndResize(term, fitAddon, term.element?.parentElement ?? null);

		// Schedule a second refit once the font finishes loading
		scheduleFontSettleRefit(
			term,
			() => termRef.current === term,
			() => {
				const changed = measureAndResize(term, fitAddon, term.element?.parentElement ?? null);
				// Clear atlas again after font settles — metrics may have changed
				const w = webglAddonRef.current?.();
				if (w) {
					try { w.clearTextureAtlas(); } catch {}
				}
				term.refresh(0, Math.max(0, term.rows - 1));
				if (changed) {
					resizePty({ sessionId, rows: term.rows, cols: term.cols });
				}
				return changed;
			},
			() => resizePty({ sessionId, rows: term.rows, cols: term.cols }),
		);
	}, [fontFamily, fontSize, sessionId]);

	useEffect(() => {
		if (!isActive || !termRef.current) return;
		const focusFrame = window.requestAnimationFrame(() => {
			termRef.current?.focus();
		});
		return () => {
			window.cancelAnimationFrame(focusFrame);
		};
	}, [isActive]);

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

	const closePendingLinkDialog = useCallback(() => {
		setPendingLink(null);
	}, []);

	const openPendingLinkExternally = useCallback(() => {
		const uri = pendingLink;
		if (!uri) return;
		setPendingLink(null);
		void open(uri);
	}, [pendingLink]);

	const handleTerminalLinkOpen = useCallback(
		(event: MouseEvent, uri: string) => {
			if (shouldBypassTerminalLinkConfirm(event)) {
				void open(uri);
				return;
			}
			setPendingLink(uri);
		},
		[],
	);

	// Stable ref callback — only re-runs when profileId/sessionId changes
	const terminalRef = useCallback(
		(container: HTMLDivElement | null) => {
			if (!container) return;
			const unlisteners: UnlistenFn[] = [];
			const cleanups: (() => void)[] = [];

			let disposed = false;
			isStreamReadyRef.current = false;
			pendingEventsRef.current = [];
			const liveOutputBuffer: string[] = [];
			let liveOutputFrame: number | null = null;

			// --- Wrapper-div pattern (SuperSet) ---
			// xterm opens into a persistent wrapper div that can be moved
			// between DOM containers without disposing the terminal.
			const wrapper = document.createElement("div");
			wrapper.style.width = "100%";
			wrapper.style.height = "100%";

			const savedDims = loadSavedDimensions(sessionId);
			const cols = savedDims?.cols ?? DEFAULT_COLS;
			const rows = savedDims?.rows ?? DEFAULT_ROWS;

			const sanitizedFont = buildFontFamilyCss(initFontFamilyRef.current);
			applyTerminalFontFamilyCssVariable(wrapper, sanitizedFont);

			// 1. Create xterm (sync) with SuperSet-aligned options
			const term = new XTerm({
				cols,
				rows,
				fontFamily: sanitizedFont,
				fontSize: initFontSizeRef.current,
				theme: initThemeRef.current,
				allowProposedApi: true,
				cursorBlink: true,
				cursorStyle: "bar",
				cursorWidth: 4,
				cursorInactiveStyle: "outline",
				macOptionIsMeta: false,
				screenReaderMode: false,
				scrollback: TERMINAL_SCROLLBACK,
				vtExtensions: { kittyKeyboard: true },
				scrollbar: { showScrollbar: false },
				linkHandler: {
					activate: handleTerminalLinkOpen,
				},
				windowOptions: {
					getCellSizePixels: true,
					getWinSizeChars: true,
					getWinSizePixels: true,
				},
			});

			// Open into wrapper, then attach wrapper to container
			term.open(wrapper);
			container.appendChild(wrapper);
			termRef.current = term;

			// 2. Load all addons via lib (WebGL + degradation memory + Unicode11 +
			//    Serialize + Search + Clipboard + Image + Ligatures + Progress + WebLinks)
			const addonsResult = loadAddons(term, {
				onWebLinkActivate: handleTerminalLinkOpen,
			});
			fitAddonRef.current = addonsResult.fitAddon;
			serializeAddonRef.current = addonsResult.serializeAddon;
			webglAddonRef.current = addonsResult.webglAddon;
			cleanups.push(addonsResult.dispose);

			// 3. Suppress query response sequences (CPR, focus reports, mode reports)
			cleanups.push(suppressQueryResponses(term));

			// 4. Image paste fallback — send ^V for non-text clipboard payloads
			cleanups.push(installImagePasteFallback(term, wrapper));

			// 5. Combined key handler: app-specific shortcuts + kitty protocol suppression
			const kittyHandler = createTerminalKeyEventHandler(term);
			term.attachCustomKeyEventHandler((event) => {
				// 5a. App-specific shortcuts first (font size, clear, copy/paste, sequences)
				const action = getTerminalShortcutAction(event);
				if (action) {
					// Ctrl+C with no selection: pass through so xterm sends ^C (SIGINT)
					if (
						action.type === "copy-selection-or-interrupt"
						&& !term.hasSelection()
					) {
						return true;
					}

					event.preventDefault();
					event.stopPropagation();

					if (action.type === "increase-font-size") {
						increaseFontSize();
						return false;
					}
					if (action.type === "decrease-font-size") {
						decreaseFontSize();
						return false;
					}
					if (action.type === "clear-screen") {
						term.clear();
						void clearPtyOutput({ sessionId })
							.catch(() => {})
							.finally(() => {
								void writeToPty({ sessionId, data: "\x0C" });
							});
						return false;
					}
					if (action.type === "copy-selection-or-interrupt") {
						const selection = term.getSelection();
						if (selection) {
							void writeClipboardText(selection).catch(() => {});
						}
						return false;
					}
					if (action.type === "paste-clipboard") {
						void readClipboardText()
							.then((text) => {
								if (text) {
									void writeToPty({ sessionId, data: text });
								}
							})
							.catch(() => {});
						return false;
					}
					void writeToPty({ sessionId, data: action.sequence });
					return false;
				}

				// 5b. Delegate to kitty protocol handler (line edit, clipboard bubble, select-all)
				return kittyHandler(event);
			});
			cleanups.push(() => term.attachCustomKeyEventHandler(() => true));

			// 6. Register file-path link provider
			const fileLinkProvider = new FileLinkProvider({ profileId });
			fileLinkProvider.setTerminal(term);
			const fileLinkDisposable = term.registerLinkProvider(fileLinkProvider);
			cleanups.push(() => fileLinkDisposable.dispose());

			// 7. Restore buffer from localStorage (cold restart scrollback)
			restoreBuffer(sessionId, term);

			// 8. Initial fit + resize PTY
			addonsResult.fitAddon.fit();
			measureAndResize(term, addonsResult.fitAddon, container);
			resizePty({ sessionId, rows: term.rows, cols: term.cols });

			// 9. Font-settle refit — xterm measured cell width at open() time
			//    using whatever font was loaded; refit once the configured font settles.
			scheduleFontSettleRefit(
				term,
				() => termRef.current === term && !disposed,
				() => {
					const changed = measureAndResize(term, addonsResult.fitAddon, container);
					if (changed) {
						resizePty({ sessionId, rows: term.rows, cols: term.cols });
					}
					return changed;
				},
				() => resizePty({ sessionId, rows: term.rows, cols: term.cols }),
			);

			// 10. Debounced resize scheduler (75ms) with scroll position preservation
			const scheduler = createResizeScheduler(
				term,
				addonsResult.fitAddon,
				() => container,
				() => resizePty({ sessionId, rows: term.rows, cols: term.cols }),
			);
			const resizeObserver = new ResizeObserver(scheduler.observe);
			resizeObserver.observe(container);
			cleanups.push(() => {
				scheduler.dispose();
				resizeObserver.disconnect();
			});

			// 11. Title debouncer (75ms coalesce, matches ghostty)
			const titleDebouncer = new TitleDebouncer();
			cleanups.push(() => titleDebouncer.dispose());
			const titleDisposable = term.onTitleChange((title) => {
				titleDebouncer.set(title);
			});
			cleanups.push(() => titleDisposable.dispose());
			titleDebouncer.subscribe(() => {
				const title = titleDebouncer.value;
				if (title) {
					useTerminalStore
						.getState()
						.updateTabTitle(profileId, sessionId, title);
				}
			});

			function flushLiveOutputBuffer() {
				liveOutputFrame = null;
				if (liveOutputBuffer.length === 0 || disposed) return;
				const output = liveOutputBuffer.join("");
				liveOutputBuffer.length = 0;
				term.write(output);
			}

			function writeLiveOutput(output: string) {
				if (!output || disposed) return;
				liveOutputBuffer.push(output);
				if (liveOutputFrame !== null) return;
				liveOutputFrame = window.requestAnimationFrame(flushLiveOutputBuffer);
			}

			function flushPendingEventsAfterHistory(historyText: string) {
				const pendingText = pendingEventsRef.current.join("");
				const overlap = getSuffixPrefixOverlapLength(historyText, pendingText);
				const remainingPendingText = pendingText.slice(overlap);
				pendingEventsRef.current = [];
				isStreamReadyRef.current = true;
				if (remainingPendingText.length > 0) {
					writeLiveOutput(remainingPendingText);
				}
			}

			function replayInitialHistory(history: Uint8Array) {
				if (disposed) return;
				if (history.length === 0) {
					flushPendingEventsAfterHistory("");
					return;
				}
				const historyText = new TextDecoder().decode(history);
				term.write(history, () => {
					flushPendingEventsAfterHistory(historyText);
				});
			}

			// 12. Register Tauri event listeners + replay history
			async function setupListenersAndReplayHistory() {
				const unlistenOutput = await listen<string>(
					`pty-output-${sessionId}`,
					(event) => {
						if (!isStreamReadyRef.current) {
							pendingEventsRef.current.push(event.payload);
							return;
						}
						writeLiveOutput(event.payload);
					},
				);
				const unlistenExit = await listen(
					`pty-exit-${sessionId}`,
					() => {
						writeLiveOutput("\r\n\x1B[90m[Process exited]\x1B[0m\r\n");
					},
				);
				if (disposed) {
					unlistenOutput();
					unlistenExit();
					return;
				}
				unlisteners.push(unlistenOutput, unlistenExit);
				const restoredHistory = sessionHistory.get(sessionId);
				if (restoredHistory) {
					sessionHistory.delete(sessionId);
					replayInitialHistory(restoredHistory);
					return;
				}
				try {
					const history = await getPtySessionHistory({ sessionId });
					replayInitialHistory(new Uint8Array(history));
				} catch (error) {
					consola.warn(
						`[pty-terminal] failed to load initial history for session ${sessionId}`,
						error,
					);
					flushPendingEventsAfterHistory("");
				}
			}
			void setupListenersAndReplayHistory();

			// 13. Sync handlers
			term.onData((data) => {
				writeToPty({ sessionId, data });
			});
			term.onResize(({ rows, cols }) => {
				resizePty({ sessionId, rows, cols });
			});

			// 14. React 19 ref cleanup
			return () => {
				disposed = true;

				// Flush buffered PTY output to DB before teardown (best-effort)
				flushPtyOutput({ sessionId }).catch(() => {});

				// Persist buffer + dimensions for cold restart
				if (serializeAddonRef.current) {
					persistBuffer(sessionId, serializeAddonRef.current);
				}
				persistDimensions(sessionId, term.cols, term.rows);

				// Reset stream state
				isStreamReadyRef.current = false;
				pendingEventsRef.current = [];
				liveOutputBuffer.length = 0;
				if (liveOutputFrame !== null) {
					window.cancelAnimationFrame(liveOutputFrame);
					liveOutputFrame = null;
				}

				for (const unlisten of unlisteners) {
					unlisten();
				}
				for (const cleanup of cleanups) {
					cleanup();
				}

				// Park wrapper instead of removing — xterm survives React unmount
				getTerminalParkingContainer().appendChild(wrapper);

				termRef.current = null;
				fitAddonRef.current = null;
				serializeAddonRef.current = null;
			};
		},
		[
			decreaseFontSize,
			handleTerminalLinkOpen,
			increaseFontSize,
			profileId,
			sessionId,
		],
	);

	return (
		<>
			<div style={shellStyle}>
				<div
					ref={terminalRef}
					style={{ flex: 1, minWidth: 0, minHeight: 0 }}
				/>
			</div>

			<TerminalLinkConfirmDialog
				link={pendingLink}
				onClose={closePendingLinkDialog}
				onOpenDefault={openPendingLinkExternally}
			/>
		</>
	);
}
