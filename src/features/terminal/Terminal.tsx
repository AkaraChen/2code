import { Channel } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import {
  readText as readClipboardText,
  writeText as writeClipboardText } from
"@tauri-apps/plugin-clipboard-manager";
import { open } from "@tauri-apps/plugin-shell";
import type { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as XTerm } from "@xterm/xterm";
import consola from "consola";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotificationStore } from "@/features/settings/stores/notificationStore";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import {
  attachPtyOutput,
  clearPtyOutput,
  detachPtyOutput,
  flushPtyOutput,
  getPtySessionHistory,
  playSystemSound,
  resizePty,
  streamPtyOutput,
  writeToPty } from
"@/generated";import { toast } from "sonner";

import {
  createAgentStatusDetector,
  readTerminalDetectionScreen } from
"./detector";
import { FileLinkProvider } from "./FileLinkProvider";
import { TerminalLinkConfirmDialog } from "./TerminalLinkConfirmDialog";
import { useTerminalTheme } from "./hooks";
import { getTerminalShortcutAction } from "./keybindings";
import {
  isAllowedTerminalLinkScheme,
  shouldBypassTerminalLinkConfirm,
} from "./linkOpening";
import { concatBytes, getSuffixPrefixOverlapLengthBytes } from "./overlap";
import { sessionHistory } from "./state";
import { useTerminalStore, type AgentStatus } from "./store";
import {
  applyTerminalFontFamilyCssVariable,
  buildFontFamilyCss,
  createResizeScheduler,
  createTerminalKeyEventHandler,
  BUFFER_STORAGE_PREFIX,
  DIMS_STORAGE_PREFIX,
  getTerminalParkingContainer,
  installImagePasteFallback,
  loadAddons,
  measureAndResize,
  scheduleFontSettleRefit,
  suppressQueryResponses,
  TitleDebouncer } from
"./lib";
import {
  sendAgentWaitingNotification,
  shouldNotifyAgentWaiting,
} from "./lib/agentNotification";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_SCROLLBACK = 5000;
const SERIALIZE_SCROLLBACK = 1000;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 32;
const AGENT_DETECTION_INTERVAL_MS = 250;
const HIDDEN_DETECTION_MULTIPLIER = 8;

function loadSavedDimensions(sessionId: string): {cols: number;rows: number;} | null {
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
      JSON.stringify({ cols, rows })
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
  const isStreamReadyRef = useRef(false);
  const pendingEventsRef = useRef<Uint8Array[]>([]);
  const isActiveRef = useRef(isActive);
  const runAgentDetectionNowRef = useRef<(() => void) | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
  const fontSize = useTerminalSettingsStore((s) => s.fontSize);
  const increaseFontSize = useTerminalSettingsStore(
    (s) => s.increaseFontSize
  );
  const decreaseFontSize = useTerminalSettingsStore(
    (s) => s.decreaseFontSize
  );
  const theme = useTerminalTheme();

  const initFontFamilyRef = useRef(fontFamily);
  const initFontSizeRef = useRef(fontSize);
  const initThemeRef = useRef(theme);

  isActiveRef.current = isActive;

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
      (term as unknown as {_wrapper?: HTMLElement;})._wrapper ?? term.element ?? document.body,
      sanitizedFont
    );

    // The DOM renderer repaints glyphs directly; a full refresh is enough to
    // pick up the new font (no texture atlas to invalidate).
    term.refresh(0, Math.max(0, term.rows - 1));

    // Refit immediately if visible
    measureAndResize(term, fitAddon, term.element?.parentElement ?? null);

    // Schedule a second refit once the font finishes loading
    scheduleFontSettleRefit(
      term,
      () => termRef.current === term,
      () => {
        const changed = measureAndResize(term, fitAddon, term.element?.parentElement ?? null);
        // Repaint after font settles — metrics may have changed
        term.refresh(0, Math.max(0, term.rows - 1));
        if (changed) {
          resizePty({ sessionId, rows: term.rows, cols: term.cols });
        }
        return changed;
      },
      () => resizePty({ sessionId, rows: term.rows, cols: term.cols })
    );
  }, [fontFamily, fontSize, sessionId]);

  useEffect(() => {
    if (!isActive || !termRef.current) return;
    runAgentDetectionNowRef.current?.();
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
      boxSizing: "border-box" as const,
      overflow: "hidden"
    }),
    [theme.background]
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
      if (
        shouldBypassTerminalLinkConfirm(event) &&
        isAllowedTerminalLinkScheme(uri)
      ) {
        void open(uri);
        return;
      }
      setPendingLink(uri);
    },
    []
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
      const liveOutputBuffer: Uint8Array[] = [];
      let liveOutputFrame: number | null = null;
      let agentDetectionTimer: number | null = null;
      let hasPendingAgentDetection = false;
      let lastAgentDetectionAt = 0;
      let lastCopiedSelection = "";
      const streamId = crypto.randomUUID();
      const agentDetector = createAgentStatusDetector();
      let latestTitle: string | null = null;
      let latestProgress = "0;0";
      let publishedAgentStatus: AgentStatus | null =
        useTerminalStore.getState().agentStatuses[sessionId] ?? null;
      let lastLoggedAgentStatus: string | null = null;
      let term: XTerm;

      function playWaitingSound() {
        const { enabled, sound } = useNotificationStore.getState();
        if (!enabled || !sound) return;
        void playSystemSound({ name: sound }).catch((error) => {
          consola.warn(
            `[pty-terminal] failed to play agent notification sound for session ${sessionId}`,
            error
          );
        });
      }

      function getCurrentTabTitle() {
        const tab = useTerminalStore.
        getState().
        profiles[profileId]?.tabs.find((tab) => tab.id === sessionId);
        return tab?.title || latestTitle || sessionId;
      }

      function publishAgentStatus(
        status: AgentStatus | null,
        agentId: string | null
      ) {
        if (publishedAgentStatus === status) return;
        const previousStatus = publishedAgentStatus;
        publishedAgentStatus = status;
        useTerminalStore.
        getState().
        setAgentStatus(sessionId, status ?? "idle");
        if (status === "waiting" && previousStatus !== "waiting") {
          playWaitingSound();
          if (shouldNotifyAgentWaiting({
            status,
            previousStatus,
            notificationsEnabled: useNotificationStore.getState().enabled,
            windowFocused: document.hasFocus()
          })) {
            void sendAgentWaitingNotification({
              agentId,
              tabTitle: getCurrentTabTitle()
            });
          }
        }
      }

      function runAgentDetectionNow() {
        agentDetectionTimer = null;
        if (disposed || !isStreamReadyRef.current) return;
        lastAgentDetectionAt = performance.now();
        const result = agentDetector.detect({
          screen: readTerminalDetectionScreen(term),
          oscTitle: latestTitle,
          oscProgress: latestProgress
        });
        const logSignature = `${result.status}|${result.agentId ?? ""}|${result.ruleId ?? ""}`;
        if (logSignature !== lastLoggedAgentStatus) {
          lastLoggedAgentStatus = logSignature;
          consola.debug("[2code-agent-status] check", {
            sessionId,
            status: result.status,
            agentId: result.agentId,
            ruleId: result.ruleId,
            state: result.state
          });
        }
        publishAgentStatus(result.status, result.agentId);
      }

      runAgentDetectionNowRef.current = runAgentDetectionNow;

      function scheduleAgentDetection() {
        if (disposed) return;
        if (!isStreamReadyRef.current) {
          hasPendingAgentDetection = true;
          return;
        }
        hasPendingAgentDetection = false;
        if (agentDetectionTimer !== null) return;
        const elapsed = performance.now() - lastAgentDetectionAt;
        const interval = isActiveRef.current ?
          AGENT_DETECTION_INTERVAL_MS :
          AGENT_DETECTION_INTERVAL_MS * HIDDEN_DETECTION_MULTIPLIER;
        const delay = Math.max(0, interval - elapsed);
        agentDetectionTimer = window.setTimeout(runAgentDetectionNow, delay);
      }

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
      term = new XTerm({
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
          activate: handleTerminalLinkOpen
        },
        windowOptions: {
          getCellSizePixels: true,
          getWinSizeChars: true,
          getWinSizePixels: true
        }
      });

      // Open into wrapper, then attach wrapper to container
      term.open(wrapper);
      container.appendChild(wrapper);
      termRef.current = term;

      // 2. Load all addons via lib (Unicode11 + Serialize + Search +
      //    Clipboard + Image + Ligatures + Progress + WebLinks). Rendering
      //    uses xterm.js's built-in DOM renderer (no GPU addon).
      const addonsResult = loadAddons(term, {
        onWebLinkActivate: handleTerminalLinkOpen
      });
      fitAddonRef.current = addonsResult.fitAddon;
      serializeAddonRef.current = addonsResult.serializeAddon;
      cleanups.push(addonsResult.dispose);

      // 3. Suppress query response sequences (CPR, focus reports, mode reports)
      cleanups.push(suppressQueryResponses(term));

      // 4. Image paste fallback — send ^V for non-text clipboard payloads
      cleanups.push(installImagePasteFallback(term, wrapper));

      function copyTerminalSelection(selection: string) {
        if (!selection || selection === lastCopiedSelection) return;
        lastCopiedSelection = selection;
        void writeClipboardText(selection).
        then(() => {
          toast.success(
            "Text copied");



        }).
        catch(() => {});
      }

      const selectionDisposable = term.onSelectionChange(() => {
        if (!term.hasSelection()) {
          lastCopiedSelection = "";
          return;
        }
        copyTerminalSelection(term.getSelection());
      });
      cleanups.push(() => selectionDisposable.dispose());

      // 5. Combined key handler: app-specific shortcuts + kitty protocol suppression
      const kittyHandler = createTerminalKeyEventHandler(term);
      term.attachCustomKeyEventHandler((event) => {
        // 5a. App-specific shortcuts first (font size, clear, copy/paste, sequences)
        const action = getTerminalShortcutAction(event);
        if (action) {
          // Ctrl+C with no selection: pass through so xterm sends ^C (SIGINT)
          if (
          action.type === "copy-selection-or-interrupt" &&
          !term.hasSelection())
          {
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
            void clearPtyOutput({ sessionId }).
            catch(() => {}).
            finally(() => {
              void writeToPty({ sessionId, data: "\x0C" });
            });
            return false;
          }
          if (action.type === "copy-selection-or-interrupt") {
            copyTerminalSelection(term.getSelection());
            return false;
          }
          if (action.type === "paste-clipboard") {
            void readClipboardText().
            then((text) => {
              if (text) {
                void writeToPty({ sessionId, data: text });
              }
            }).
            catch(() => {});
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
        () => resizePty({ sessionId, rows: term.rows, cols: term.cols })
      );

      // 10. Debounced resize scheduler (75ms) with scroll position preservation
      const scheduler = createResizeScheduler(
        term,
        addonsResult.fitAddon,
        () => container,
        () => resizePty({ sessionId, rows: term.rows, cols: term.cols })
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
        latestTitle = title;
        if (title) {
          useTerminalStore.
          getState().
          updateTabTitle(profileId, sessionId, title);
        }
        scheduleAgentDetection();
      });
      const progressDisposable = addonsResult.progressAddon.onChange((progress) => {
        latestProgress = `${progress.state};${progress.value}`;
        scheduleAgentDetection();
      });
      latestProgress = `${addonsResult.progressAddon.progress.state};${addonsResult.progressAddon.progress.value}`;
      cleanups.push(() => progressDisposable.dispose());

      function flushLiveOutputBuffer() {
        liveOutputFrame = null;
        if (liveOutputBuffer.length === 0 || disposed) return;
        const output = concatBytes(liveOutputBuffer);
        liveOutputBuffer.length = 0;
        term.write(output, scheduleAgentDetection);
      }

      function writeLiveOutput(output: Uint8Array) {
        if (output.length === 0 || disposed) return;
        liveOutputBuffer.push(output);
        if (liveOutputFrame !== null) return;
        liveOutputFrame = window.requestAnimationFrame(flushLiveOutputBuffer);
      }

      function flushPendingEventsAfterHistory(history: Uint8Array) {
        const pending = concatBytes(pendingEventsRef.current);
        const overlap = getSuffixPrefixOverlapLengthBytes(history, pending);
        const remaining = pending.subarray(overlap);
        pendingEventsRef.current = [];
        isStreamReadyRef.current = true;
        if (hasPendingAgentDetection) {
          scheduleAgentDetection();
        }
        if (remaining.length > 0) {
          writeLiveOutput(remaining);
        }
      }

      function replayInitialHistory(history: Uint8Array) {
        if (disposed) return;
        if (history.length === 0) {
          flushPendingEventsAfterHistory(history);
          return;
        }
        term.write(history, () => {
          flushPendingEventsAfterHistory(history);
        });
      }

      // 12. Register PTY output channel + exit listener, then replay history.
      async function setupListenersAndReplayHistory() {
        const outputChannel = new Channel<ArrayBuffer>();
        outputChannel.onmessage = (payload) => {
          const bytes = new Uint8Array(payload);
          if (!isStreamReadyRef.current) {
            pendingEventsRef.current.push(bytes);
            return;
          }
          writeLiveOutput(bytes);
        };
        await attachPtyOutput({ sessionId, streamId });
        if (disposed) {
          void detachPtyOutput({ sessionId, streamId }).catch(() => {});
          return;
        }
        void streamPtyOutput({ sessionId, streamId, onOutput: outputChannel }).catch((error) => {
          consola.warn(
            `[pty-terminal] failed to stream output for session ${sessionId}`,
            error
          );
        });
        const unlistenExit = await listen(
          `pty-exit-${sessionId}`,
          () => {
            latestTitle = null;
            latestProgress = "0;0";
            publishAgentStatus(null, null);
            writeLiveOutput(
              new TextEncoder().encode(
                "\r\n\x1B[90m[Process exited]\x1B[0m\r\n"
              )
            );
          }
        );
        if (disposed) {
          void detachPtyOutput({ sessionId, streamId }).catch(() => {});
          unlistenExit();
          return;
        }
        unlisteners.push(unlistenExit);
        const restoredHistory = sessionHistory.get(sessionId);
        if (restoredHistory) {
          sessionHistory.delete(sessionId);
          replayInitialHistory(restoredHistory);
          return;
        }
        try {
          await flushPtyOutput({ sessionId });
          const history = await getPtySessionHistory({ sessionId });
          replayInitialHistory(new Uint8Array(history));
        } catch (error) {
          consola.warn(
            `[pty-terminal] failed to load initial history for session ${sessionId}`,
            error
          );
          flushPendingEventsAfterHistory(new Uint8Array(0));
        }
      }
      void setupListenersAndReplayHistory().catch((error) => {
        consola.warn(
          `[pty-terminal] setup failed for session ${sessionId}`,
          error
        );
      });

      // 13. Sync handlers
      const dataDisposable = term.onData((data) => {
        writeToPty({ sessionId, data }).catch((error) => {
          consola.warn(
            `[pty-terminal] failed to write input for session ${sessionId}`,
            error
          );
        });
      });
      const resizeDisposable = term.onResize(({ rows, cols }) => {
        resizePty({ sessionId, rows, cols });
      });
      cleanups.push(() => dataDisposable.dispose());
      cleanups.push(() => resizeDisposable.dispose());

      // 14. React 19 ref cleanup
      return () => {
        disposed = true;

        void detachPtyOutput({ sessionId, streamId }).catch(() => {});

        // Flush buffered PTY output to DB before teardown (best-effort)
        flushPtyOutput({ sessionId }).catch(() => {});

        const stillOpen = Object.values(useTerminalStore.getState().profiles).some(
          (profile) => profile.tabs.some((tab) => tab.id === sessionId)
        );

        if (stillOpen) {
          // Persist buffer + dimensions for cold restart or live remount.
          if (serializeAddonRef.current) {
            persistBuffer(sessionId, serializeAddonRef.current);
          }
          persistDimensions(sessionId, term.cols, term.rows);
        }

        // Reset stream state
        isStreamReadyRef.current = false;
        pendingEventsRef.current = [];
        liveOutputBuffer.length = 0;
        if (liveOutputFrame !== null) {
          window.cancelAnimationFrame(liveOutputFrame);
          liveOutputFrame = null;
        }
        if (agentDetectionTimer !== null) {
          window.clearTimeout(agentDetectionTimer);
          agentDetectionTimer = null;
        }
        if (runAgentDetectionNowRef.current === runAgentDetectionNow) {
          runAgentDetectionNowRef.current = null;
        }

        for (const unlisten of unlisteners) {
          unlisten();
        }
        for (const cleanup of cleanups) {
          cleanup();
        }

        if (stillOpen) {
          // Park wrapper instead of removing — xterm survives React unmount
          getTerminalParkingContainer().appendChild(wrapper);
        } else if (typeof term.dispose === "function") {
          term.dispose();
          wrapper.remove();
        } else {
          wrapper.remove();
        }

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
    sessionId]

  );

  return (
    <>
			<div style={shellStyle}>
				<div
          ref={terminalRef}
          style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
        
			</div>

			<TerminalLinkConfirmDialog
        link={pendingLink}
        onClose={closePendingLinkDialog}
        onOpenDefault={openPendingLinkExternally} />
      
		</>);

}
