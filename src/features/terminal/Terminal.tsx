import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ProgressAddon } from "@xterm/addon-progress";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { open } from "@tauri-apps/plugin-shell";
import consola from "consola";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
	clearPtyOutput,
	flushPtyOutput,
	resizePty,
	writeToPty,
} from "@/generated";
import { useTerminalTheme } from "./hooks";
import { getTerminalShortcutAction } from "./keybindings";
import { sessionHistory } from "./state";
import { useTerminalStore } from "./store";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
	profileId: string;
	sessionId: string;
	isActive: boolean;
}

export function Terminal({ profileId, sessionId, isActive }: TerminalProps) {
	const termRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const isStreamReadyRef = useRef(false);
	const pendingEventsRef = useRef<string[]>([]);
	const layoutFrameRef = useRef<number | null>(null);
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const increaseFontSize = useTerminalSettingsStore((s) => s.increaseFontSize);
	const decreaseFontSize = useTerminalSettingsStore((s) => s.decreaseFontSize);
	const theme = useTerminalTheme();

	const initFontFamilyRef = useRef(fontFamily);
	const initFontSizeRef = useRef(fontSize);
	const initThemeRef = useRef(theme);

	const syncTerminalLayout = useCallback((delayFrames = 0) => {
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

			const term = termRef.current;
			const fitAddon = fitAddonRef.current;
			if (!term || !fitAddon) return;

			const nextDimensions = fitAddon.proposeDimensions();
			if (
				nextDimensions &&
				(nextDimensions.cols !== term.cols || nextDimensions.rows !== term.rows)
			) {
				fitAddon.fit();
				return;
			}

			if (term.rows > 0) {
				term.refresh(0, term.rows - 1);
			}
		};

		layoutFrameRef.current = window.requestAnimationFrame(tick);
	}, []);

	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.theme = theme;
			syncTerminalLayout();
		}
	}, [syncTerminalLayout, theme]);

	useEffect(() => {
		const term = termRef.current;
		if (!term) return;

		term.options.fontFamily = `"${fontFamily}", monospace`;
		term.options.fontSize = fontSize;
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
		if (!isActive || !termRef.current) return;

		syncTerminalLayout(2);
		const focusFrame = window.requestAnimationFrame(() => {
			termRef.current?.focus();
		});

		return () => {
			window.cancelAnimationFrame(focusFrame);
		};
	}, [isActive, syncTerminalLayout]);

	useEffect(() => {
		return () => {
			if (layoutFrameRef.current !== null) {
				window.cancelAnimationFrame(layoutFrameRef.current);
			}
		};
	}, []);

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

	// Stable ref callback — only re-runs when profileId/sessionId changes
	const terminalRef = useCallback(
		(container: HTMLDivElement | null) => {
			if (!container) return;
			const unlisteners: UnlistenFn[] = [];

			consola.info(`[pty-terminal] mount sessionId=${sessionId}`);
			let disposed = false;

			// 1. Create xterm (sync)
			const term = new XTerm({
				fontFamily: `"${initFontFamilyRef.current}", monospace`,
				fontSize: initFontSizeRef.current,
				theme: initThemeRef.current,
				cursorBlink: true,
				cursorStyle: "bar",
				cursorWidth: 4,
			});
			unlisteners.push(() => term.dispose());

			term.attachCustomKeyEventHandler((event) => {
				const action = getTerminalShortcutAction(event);
				if (!action) return true;

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

				void writeToPty({ sessionId, data: action.sequence });
				return false;
			});

			const fitAddon = new FitAddon();
			term.loadAddon(fitAddon);

			const webLinksAddon = new WebLinksAddon((_event, uri) => {
				open(uri);
			});
			term.loadAddon(webLinksAddon);

			term.open(container);
			termRef.current = term;
			fitAddonRef.current = fitAddon;

			// WebGL renderer — must load after open(); fall back silently if unavailable
			try {
				const webglAddon = new WebglAddon();
				webglAddon.onContextLoss(() => webglAddon.dispose());
				term.loadAddon(webglAddon);
				unlisteners.push(() => webglAddon.dispose());
			} catch {
				// WebGL unavailable — xterm falls back to canvas 2D renderer
			}

			term.loadAddon(new ClipboardAddon());
			term.loadAddon(new ImageAddon());
			term.loadAddon(new LigaturesAddon());
			term.loadAddon(new ProgressAddon());

			fitAddon.fit();
			syncTerminalLayout(1);

			// Resize PTY to match xterm dimensions
			resizePty({ sessionId, rows: term.rows, cols: term.cols });

			// 2. Register listeners (before history write, but buffer events)
			async function setupListeners() {
				const unlistenOutput = await listen<string>(
					`pty-output-${sessionId}`,
					(event) => {
						if (!isStreamReadyRef.current) {
							pendingEventsRef.current.push(event.payload);
							return;
						}
						term.write(event.payload);
					},
				);
				const unlistenExit = await listen(
					`pty-exit-${sessionId}`,
					() => {
						term.write("\r\n\x1B[90m[Process exited]\x1B[0m\r\n");
					},
				);
				if (disposed) {
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

			// 3. Write history from module-level Map
			const history = sessionHistory.get(sessionId);
			if (history && history.length > 0) {
				consola.info(
					`[pty-restore] writing ${history.length} bytes of history for session ${sessionId}`,
				);
				const renderDisposable = term.onRender(() => {
					renderDisposable.dispose();
					term.write(history, () => {
						sessionHistory.delete(sessionId);
						isStreamReadyRef.current = true;
						for (const payload of pendingEventsRef.current) {
							term.write(payload);
						}
						pendingEventsRef.current = [];
					});
				});
			} else {
				isStreamReadyRef.current = true;
			}

			// 4. Sync handlers
			term.onData((data) => {
				writeToPty({ sessionId, data });
			});

			term.onResize(({ rows, cols }) => {
				resizePty({ sessionId, rows, cols });
			});

			term.onTitleChange((title) => {
				useTerminalStore
					.getState()
					.updateTabTitle(profileId, sessionId, title);
			});

			const resizeObserver = new ResizeObserver((entries) => {
				const entry = entries[0];
				if (
					entry &&
					entry.contentRect.width > 0 &&
					entry.contentRect.height > 0
				) {
					syncTerminalLayout();
				}
			});
			resizeObserver.observe(container);
			unlisteners.push(() => resizeObserver.disconnect());

			// 5. React 19 ref cleanup
			return () => {
				consola.info(`[pty-terminal] unmount sessionId=${sessionId}`);
				disposed = true;

				// Flush buffered PTY output to DB before teardown (best-effort)
				flushPtyOutput({ sessionId }).catch(() => {});

				// Reset stream state (sessionHistory is only deleted after successful write)
				isStreamReadyRef.current = false;
				pendingEventsRef.current = [];

				for (const unlisten of unlisteners) {
					unlisten();
				}

				termRef.current = null;
				fitAddonRef.current = null;
			};
		},
		[
			decreaseFontSize,
			increaseFontSize,
			profileId,
			sessionId,
			syncTerminalLayout,
		],
	);

	return (
		<div style={shellStyle}>
			<div ref={terminalRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
		</div>
	);
}
