import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-shell";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import consola from "consola";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { flushPtyOutput, resizePty, writeToPty } from "@/generated";
import { useTerminalTheme } from "./hooks";
import { sessionHistory } from "./state";
import { useTerminalStore } from "./store";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
	profileId: string;
	sessionId: string;
}

export function Terminal({ profileId, sessionId }: TerminalProps) {
	const termRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const isStreamReadyRef = useRef(false);
	const pendingEventsRef = useRef<string[]>([]);
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const theme = useTerminalTheme();

	const initFontFamilyRef = useRef(fontFamily);
	const initFontSizeRef = useRef(fontSize);
	const initThemeRef = useRef(theme);

	// Update theme without re-mounting the terminal
	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.theme = theme;
		}
	}, [theme]);

	// Update font family without re-mounting the terminal
	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.fontFamily = `"${fontFamily}", monospace`;
			fitAddonRef.current?.fit();
		}
	}, [fontFamily]);

	// Update font size without re-mounting the terminal
	useEffect(() => {
		if (termRef.current) {
			termRef.current.options.fontSize = fontSize;
			fitAddonRef.current?.fit();
		}
	}, [fontSize]);

	const containerStyle = useMemo(
		() => ({
			width: "100%",
			height: "100%",
			padding: "8px 0 0 8px",
			background: theme.background,
			border: "0.5px solid var(--chakra-colors-border-subtle)",
			boxSizing: "border-box" as const,
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

			const fitAddon = new FitAddon();
			term.loadAddon(fitAddon);

			const webLinksAddon = new WebLinksAddon((_event, uri) => {
				open(uri);
			});
			term.loadAddon(webLinksAddon);

			term.open(container);
			fitAddon.fit();

			termRef.current = term;
			fitAddonRef.current = fitAddon;

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
					fitAddon.fit();
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
		[profileId, sessionId],
	);

	return <div ref={terminalRef} style={containerStyle} />;
}
