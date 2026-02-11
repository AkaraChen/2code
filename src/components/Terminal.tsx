import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import type { ITheme } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useRef,
} from "react";
import { ptyApi } from "@/api/pty";
import { useThemePreference } from "@/components/ThemeProvider";
import "@xterm/xterm/css/xterm.css";

const darkTheme: ITheme = {
	background: "#161616",
	foreground: "#BFD4E1",
	cursor: "#f0f3bd",
	selectionBackground: "#353535",
	black: "#353535",
	red: "#d97397",
	green: "#CEE397",
	yellow: "#E9CA5C",
	blue: "#63B0C6",
	magenta: "#E9AEBA",
	cyan: "#70C1B3",
	white: "#BFD4E1",
	brightBlack: "#729098",
	brightRed: "#ffadad",
	brightGreen: "#caffbf",
	brightYellow: "#f0f3bd",
	brightBlue: "#9bf6ff",
	brightMagenta: "#ffc6ff",
	brightCyan: "#a8dadc",
	brightWhite: "#ffffff",
};

const lightTheme: ITheme = {
	background: "#ffffff",
	foreground: "#24292f",
	cursor: "#0969da",
	selectionBackground: "#bbd6f0",
	black: "#24292f",
	red: "#cf222e",
	green: "#116329",
	yellow: "#4d2d00",
	blue: "#0969da",
	magenta: "#8250df",
	cyan: "#1b7c83",
	white: "#6e7781",
	brightBlack: "#57606a",
	brightRed: "#a40e26",
	brightGreen: "#1a7f37",
	brightYellow: "#633c01",
	brightBlue: "#218bff",
	brightMagenta: "#a475f9",
	brightCyan: "#3192aa",
	brightWhite: "#8c959f",
};

export interface TerminalHandle {
	runCode: (code: string) => void;
}

interface TerminalProps {
	sessionId: string;
	className?: string;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
	({ sessionId, className }, ref) => {
		const containerRef = useRef<HTMLDivElement>(null);
		const termRef = useRef<XTerm | null>(null);
		const fitAddonRef = useRef<FitAddon | null>(null);
		const unlistenersRef = useRef<UnlistenFn[]>([]);
		const { isDark } = useThemePreference();
		const theme = isDark ? darkTheme : lightTheme;

		if (termRef.current) {
			termRef.current.options.theme = theme;
		}

		const runCode = useCallback(
			(code: string) => {
				ptyApi.write(sessionId, code + "\n");
			},
			[sessionId],
		);

		useImperativeHandle(ref, () => ({ runCode }), [runCode]);

		useEffect(() => {
			if (!containerRef.current) return;

			const term = new XTerm({
				fontFamily:
					'"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
				fontSize: 13,
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

			// Listen for PTY output
			const setupListeners = async () => {
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
							"\r\n\x1b[90m[Process exited]\x1b[0m\r\n",
						);
					},
				);

				unlistenersRef.current.push(unlistenOutput, unlistenExit);
			};

			setupListeners();

			// Forward user input to PTY
			const onDataDisposable = term.onData((data) => {
				ptyApi.write(sessionId, data);
			});

			// Handle terminal resize
			const onResizeDisposable = term.onResize(({ rows, cols }) => {
				ptyApi.resize(sessionId, rows, cols);
			});

			// Handle container resize
			const resizeObserver = new ResizeObserver(() => {
				fitAddon.fit();
			});
			resizeObserver.observe(containerRef.current);

			return () => {
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
		}, [sessionId]);

		return (
			<div
				ref={containerRef}
				className={className}
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
	},
);

Terminal.displayName = "Terminal";
