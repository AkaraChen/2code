import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke, Channel } from "@tauri-apps/api/core";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  sessionId: string;
  visible: boolean;
}

export default function Terminal({ sessionId, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Fit after opening
    fitAddon.fit();

    // Stream PTY output into xterm
    const channel = new Channel<{ data: number[] }>();
    channel.onmessage = (msg) => {
      term.write(new Uint8Array(msg.data));
    };
    invoke("resume_stream", { sessionId, channel });

    // Forward keyboard input to PTY
    const dataDisposable = term.onData((data) => {
      const encoder = new TextEncoder();
      invoke("write_to_pty", {
        sessionId,
        data: Array.from(encoder.encode(data)),
      });
    });

    // Sync resize to PTY backend
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      invoke("resize_pty", { sessionId, rows, cols });
    });

    // Auto-resize on container size change
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
    });
    observer.observe(container);
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      observerRef.current = null;
    };
  }, [sessionId]);

  // Re-fit when visibility changes so dimensions are correct
  useEffect(() => {
    if (visible) {
      fitAddonRef.current?.fit();
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{ display: visible ? "block" : "none", width: "100%", height: "100%" }}
    />
  );
}
