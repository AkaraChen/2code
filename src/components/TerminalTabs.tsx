import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Tabs, TabList, Tab } from "@carbon/react";
import { Add, Close } from "@carbon/react/icons";
import Terminal from "./Terminal";

interface TerminalTab {
  id: string; // PTY session ID
  title: string;
}

interface PtySessionInfo {
  id: string;
  shell: string;
  cwd: string;
  rows: number;
  cols: number;
  created_at: number;
}

export default function TerminalTabs() {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const counterRef = useRef(0);

  const activeIndex = tabs.findIndex((t) => t.id === activeId);

  const createTab = useCallback(async () => {
    const info = await invoke<PtySessionInfo>("create_pty");
    counterRef.current += 1;
    const tab: TerminalTab = { id: info.id, title: `Terminal ${counterRef.current}` };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, []);

  const closeTab = useCallback(
    async (tabId: string) => {
      await invoke("delete_pty", { sessionId: tabId });
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = prev.filter((t) => t.id !== tabId);

        if (next.length === 0) {
          return next;
        }

        if (tabId === activeId) {
          const newIdx = Math.min(idx, next.length - 1);
          setActiveId(next[newIdx].id);
        }

        return next;
      });
    },
    [activeId],
  );

  useEffect(() => {
    if (tabs.length === 0) {
      createTab();
    }
  }, [tabs.length, createTab]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex items-center shrink-0">
        <Tabs
          selectedIndex={activeIndex >= 0 ? activeIndex : 0}
          onChange={({ selectedIndex }) => {
            if (selectedIndex < tabs.length) {
              setActiveId(tabs[selectedIndex].id);
            }
          }}
        >
          <TabList contained>
            {tabs.map((tab) => (
              <Tab key={tab.id}>
                <span className="flex items-center gap-2">
                  {tab.title}
                  <Close
                    size={16}
                    className="opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  />
                </span>
              </Tab>
            ))}
          </TabList>
        </Tabs>
        <button
          className="px-3 h-full text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover)]"
          onClick={createTab}
        >
          <Add size={16} />
        </button>
      </div>

      {/* Terminal area — all terminals stay mounted, hidden via CSS */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeId ? "block" : "none" }}
          >
            <Terminal sessionId={tab.id} visible={tab.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
