import { useCallback, useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ptyApi } from "@/api/pty";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  runCode: (code: string) => void;
}

interface TerminalProps {
  shell: string;
  className?: string;
}

export const Terminal = forwardRef<TerminalHandle, TerminalProps>(
  ({ shell, className }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const unlistenersRef = useRef<UnlistenFn[]>([]);

    const runCode = useCallback((code: string) => {
      if (sessionIdRef.current) {
        ptyApi.write(sessionIdRef.current, code + "\n");
      }
    }, []);

    useImperativeHandle(ref, () => ({ runCode }), [runCode]);

    useEffect(() => {
      if (!containerRef.current) return;

      const term = new XTerm({
        fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Consolas, monospace',
        fontSize: 13,
        theme: {
          background: "#0a0a0a",
          foreground: "#f5f5f5",
          cursor: "#4ade80",
          selectionBackground: "#333333",
        },
        cursorBlink: true,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // Start PTY session
      const rows = term.rows;
      const cols = term.cols;

      ptyApi
        .createSession(shell, rows, cols)
        .then(async (sessionId) => {
          sessionIdRef.current = sessionId;

          // Listen for PTY output
          const unlistenOutput = await listen<string>(
            `pty-output-${sessionId}`,
            (event) => {
              term.write(event.payload);
            },
          );

          // Listen for PTY exit
          const unlistenExit = await listen(
            `pty-exit-${sessionId}`,
            () => {
              term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
            },
          );

          unlistenersRef.current.push(unlistenOutput, unlistenExit);
        })
        .catch((err) => {
          term.write(`\x1b[31mFailed to start shell: ${err}\x1b[0m\r\n`);
        });

      // Forward user input to PTY
      const onDataDisposable = term.onData((data) => {
        if (sessionIdRef.current) {
          ptyApi.write(sessionIdRef.current, data);
        }
      });

      // Handle terminal resize
      const onResizeDisposable = term.onResize(({ rows, cols }) => {
        if (sessionIdRef.current) {
          ptyApi.resize(sessionIdRef.current, rows, cols);
        }
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

        if (sessionIdRef.current) {
          ptyApi.close(sessionIdRef.current);
          sessionIdRef.current = null;
        }

        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }, [shell]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%" }}
      />
    );
  },
);

Terminal.displayName = "Terminal";
