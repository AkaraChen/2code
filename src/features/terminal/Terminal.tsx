import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { resizePty, writeToPty } from "@/generated";
import { useTerminalTheme } from "./hooks";
import { useTerminalStore } from "./store";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
	profileId: string;
	sessionId: string;
}

export function Terminal({ profileId, sessionId }: TerminalProps) {
	const termRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const theme = useTerminalTheme();

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

			console.log(`[pty-terminal] mount sessionId=${sessionId}`);
			let disposed = false;

			// 1. Create xterm (sync)
			const term = new XTerm({
				fontFamily: `"${fontFamily}", monospace`,
				fontSize,
				theme,
				cursorBlink: true,
				convertEol: true,
			});

			const fitAddon = new FitAddon();
			term.loadAddon(fitAddon);
			term.open(container);
			fitAddon.fit();

			termRef.current = term;
			fitAddonRef.current = fitAddon;

			// Resize PTY to match xterm dimensions
			resizePty({ sessionId, rows: term.rows, cols: term.cols });

			// 2. Write pre-fetched history (sync, from store via getState())
			const tab = useTerminalStore
				.getState()
				.profiles[profileId]?.tabs.find((t) => t.id === sessionId);
			if (tab?.pendingHistory) {
				term.write(tab.pendingHistory);
				console.log(
					`[pty-restore] wrote ${tab.pendingHistory.length} chars of history to xterm`,
				);
				useTerminalStore
					.getState()
					.consumeHistory(profileId, sessionId);
			}

			// 3. Register Tauri listeners (async, fire-and-forget with disposed guard)
			const unlisteners: UnlistenFn[] = [];
			(async () => {
				const unlistenOutput = await listen<string>(
					`pty-output-${sessionId}`,
					(event) => {
						term.write(event.payload);
					},
				);

				const unlistenExit = await listen(
					`pty-exit-${sessionId}`,
					() => {
						term.write(
							"\r\n\x1B[90m[Process exited]\x1B[0m\r\n",
						);
					},
				);

				if (disposed) {
					unlistenOutput();
					unlistenExit();
					return;
				}

				console.log(
					`[pty-terminal] live listeners registered for session ${sessionId}`,
				);
				unlisteners.push(unlistenOutput, unlistenExit);
			})();

			// 4. Sync handlers
			const onDataDisposable = term.onData((data) => {
				writeToPty({ sessionId, data });
			});

			const onResizeDisposable = term.onResize(({ rows, cols }) => {
				resizePty({ sessionId, rows, cols });
			});

			const onTitleChangeDisposable = term.onTitleChange((title) => {
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

			// 5. React 19 ref cleanup
			return () => {
				console.log(
					`[pty-terminal] unmount sessionId=${sessionId}`,
				);
				disposed = true;
				resizeObserver.disconnect();
				onDataDisposable.dispose();
				onResizeDisposable.dispose();
				onTitleChangeDisposable.dispose();

				for (const unlisten of unlisteners) {
					unlisten();
				}

				term.dispose();
				termRef.current = null;
				fitAddonRef.current = null;
			};
		},
		[profileId, sessionId, fontFamily, fontSize, theme],
	);

	return <div ref={terminalRef} style={containerStyle} />;
}
