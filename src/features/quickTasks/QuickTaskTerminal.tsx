import { open } from "@tauri-apps/plugin-shell";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ProgressAddon } from "@xterm/addon-progress";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import { useTerminalTheme } from "@/features/terminal/hooks";
import { getTerminalShortcutAction } from "@/features/terminal/keybindings";
import { shouldBypassTerminalLinkConfirm } from "@/features/terminal/linkOpening";
import { TerminalLinkConfirmDialog } from "@/features/terminal/TerminalLinkConfirmDialog";
import { resizeQuickTaskPty, writeQuickTaskPty } from "@/generated";
import {
	getQuickTaskOutput,
	subscribeQuickTaskOutput,
} from "./quickTaskRuntime";
import "@xterm/xterm/css/xterm.css";

interface QuickTaskTerminalProps {
	runId: string;
	isActive: boolean;
	isPtyReady: boolean;
}

export function QuickTaskTerminal({
	runId,
	isActive,
	isPtyReady,
}: QuickTaskTerminalProps) {
	const termRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const layoutFrameRef = useRef<number | null>(null);
	const isPtyReadyRef = useRef(isPtyReady);
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
				(nextDimensions.cols !== term.cols ||
					nextDimensions.rows !== term.rows)
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

	const resizeBackendPty = useCallback(() => {
		const term = termRef.current;
		if (!term || !isPtyReadyRef.current) return;

		void resizeQuickTaskPty({
			runId,
			rows: term.rows,
			cols: term.cols,
		}).catch(() => {});
	}, [runId]);

	useEffect(() => {
		isPtyReadyRef.current = isPtyReady;
		if (isPtyReady) {
			resizeBackendPty();
		}
	}, [isPtyReady, resizeBackendPty]);

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

	const closePendingLinkDialog = useCallback(() => {
		setPendingLink(null);
	}, []);

	const openPendingLink = useCallback(() => {
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

	const terminalRef = useCallback(
		(container: HTMLDivElement | null) => {
			if (!container) return;
			isPtyReadyRef.current = isPtyReady;
			const unlisteners: Array<() => void> = [];
			let disposed = false;

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
					void writeQuickTaskPty({ runId, data: "\x0C" });
					return false;
				}

				void writeQuickTaskPty({ runId, data: action.sequence });
				return false;
			});

			const fitAddon = new FitAddon();
			term.loadAddon(fitAddon);
			term.loadAddon(new WebLinksAddon(handleTerminalLinkOpen));

			term.open(container);
			termRef.current = term;
			fitAddonRef.current = fitAddon;

			term.loadAddon(new ClipboardAddon());
			term.loadAddon(new ImageAddon());
			term.loadAddon(new LigaturesAddon());
			term.loadAddon(new ProgressAddon());

			fitAddon.fit();
			syncTerminalLayout(1);
			resizeBackendPty();

			for (const chunk of getQuickTaskOutput(runId)) {
				term.write(chunk);
			}

			unlisteners.push(
				subscribeQuickTaskOutput(runId, (event) => {
					if (disposed) return;
					if (event.type === "clear") {
						term.clear();
						return;
					}
					term.write(event.data);
				}),
			);

			term.onData((data) => {
				void writeQuickTaskPty({ runId, data });
			});

			term.onResize(({ rows, cols }) => {
				if (!isPtyReadyRef.current) return;
				void resizeQuickTaskPty({ runId, rows, cols }).catch(() => {});
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

			return () => {
				disposed = true;
				for (const unlisten of unlisteners) {
					unlisten();
				}
				termRef.current = null;
				fitAddonRef.current = null;
			};
		},
		[
			decreaseFontSize,
			handleTerminalLinkOpen,
			increaseFontSize,
			isPtyReady,
			runId,
			resizeBackendPty,
			syncTerminalLayout,
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
				onOpen={openPendingLink}
			/>
		</>
	);
}
