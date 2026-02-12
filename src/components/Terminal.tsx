import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { ptyApi } from "@/api/pty";
import { useTerminalTheme } from "@/hooks/useTerminalTheme";
import { useFontStore } from "@/stores/fontStore";
import { useTerminalStore } from "@/stores/terminalStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
	projectId: string;
	sessionId: string;
	restoreFrom?: string;
}

export function Terminal({ projectId, sessionId, restoreFrom }: TerminalProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const unlistenersRef = useRef<UnlistenFn[]>([]);
	const fontFamily = useFontStore((s) => s.fontFamily);
	const fontSize = useFontStore((s) => s.fontSize);
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

	useEffect(() => {
		if (!containerRef.current) return;

		let disposed = false;

		const state = useFontStore.getState();
		const term = new XTerm({
			fontFamily: `"${state.fontFamily}", monospace`,
			fontSize: state.fontSize,
			theme,
			cursorBlink: true,
			convertEol: true,
		});

		const fitAddon = new FitAddon();
		term.loadAddon(fitAddon);
		term.open(containerRef.current);
		fitAddon.fit();

		termRef.current = term;
		fitAddonRef.current = fitAddon;

		// Resize PTY to match xterm dimensions
		ptyApi.resize(sessionId, term.rows, term.cols);

		// Restore history from previous session before connecting live stream
		const setup = async () => {
			if (restoreFrom) {
				try {
					const history = await ptyApi.getHistory(restoreFrom);
					if (disposed) return;
					if (history.length > 0) {
						const text = new TextDecoder().decode(
							new Uint8Array(history),
						);
						term.write(text);
					}
				} catch {
					// Old session may already be deleted — ignore
				}
				if (disposed) return;
				// Clean up old session record and store flag
				ptyApi.deleteRecord(restoreFrom).catch(() => {});
				useTerminalStore.getState().clearRestore(projectId, sessionId);
			}

			// Listen for PTY output
			const unlistenOutput = await listen<string>(
				`pty-output-${sessionId}`,
				(event) => {
					term.write(event.payload);
				},
			);

			const unlistenExit = await listen(`pty-exit-${sessionId}`, () => {
				term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
			});

			if (disposed) {
				unlistenOutput();
				unlistenExit();
				return;
			}

			unlistenersRef.current.push(unlistenOutput, unlistenExit);
		};

		setup().catch(() => {});

		// Forward user input to PTY
		const onDataDisposable = term.onData((data) => {
			ptyApi.write(sessionId, data);
		});

		// Handle terminal resize
		const onResizeDisposable = term.onResize(({ rows, cols }) => {
			ptyApi.resize(sessionId, rows, cols);
		});

		// Handle container resize
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
		resizeObserver.observe(containerRef.current);

		return () => {
			disposed = true;
			resizeObserver.disconnect();
			onDataDisposable.dispose();
			onResizeDisposable.dispose();

			for (const unlisten of unlistenersRef.current) {
				unlisten();
			}
			unlistenersRef.current = [];

			term.dispose();
			termRef.current = null;
			fitAddonRef.current = null;
		};
	}, [projectId, sessionId, restoreFrom]);

	return (
		<div
			ref={containerRef}
			style={{
				width: "100%",
				height: "100%",
				padding: "8px 0 0 8px",
				background: theme.background,
				border: "0.5px solid var(--chakra-colors-border-subtle)",
				boxSizing: "border-box",
			}}
		/>
	);
}
