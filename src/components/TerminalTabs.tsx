import { useState, useEffect, useCallback, useRef } from "react";
import { Tabs, TabList, Tab } from "@carbon/react";
import { Add, Close, Terminal as TerminalIcon } from "@carbon/react/icons";
import { Terminal } from "./Terminal";

interface TerminalTab {
  id: string;
  title: string;
}

const DEFAULT_SHELL =
  typeof window !== "undefined" ? "/bin/zsh" : "/bin/sh";

export default function TerminalTabs() {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const counterRef = useRef(0);

  const activeIndex = tabs.findIndex((t) => t.id === activeId);

  const createTab = useCallback(() => {
    counterRef.current += 1;
    const id = crypto.randomUUID();
    const tab: TerminalTab = { id, title: `Terminal ${counterRef.current}` };
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
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
      <Tabs
        selectedIndex={activeIndex >= 0 ? activeIndex : 0}
        onChange={({ selectedIndex }) => {
          // Ignore clicks on the "+" tab (last one)
          if (selectedIndex < tabs.length) {
            setActiveId(tabs[selectedIndex].id);
          }
        }}
      >
        <TabList contained>
          {tabs.map((tab) => (
            <Tab key={tab.id} renderIcon={TerminalIcon}>
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
          <Tab renderIcon={Add} onClick={createTab}>
            New
          </Tab>
        </TabList>
      </Tabs>

      {/* Terminal area — all terminals stay mounted, hidden via CSS */}
      <div className="flex-1 min-h-0 relative">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="absolute inset-0"
            style={{ display: tab.id === activeId ? "block" : "none" }}
          >
            <Terminal shell={DEFAULT_SHELL} className="h-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
