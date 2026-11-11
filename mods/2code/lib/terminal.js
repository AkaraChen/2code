import { spaces, panes, run, hc } from "herdr";

// Opens a terminal tab in a space and types `commands` into its shell, one per
// line, like 2code's startup commands (so shell functions and aliases work and
// the lines land in history). `tab.new {task}` only types into agents, so the
// new tab's terminal is found and fed with `hc send`.
export async function openTerminal(cx, { space, name, folder, commands = [] }) {
  const before = new Set((spaces().find((s) => s.id === space)?.tabs ?? []).map((t) => t.id));
  run("tab.new", { ...(space ? { space } : {}), ...(name ? { name } : {}), ...(folder ? { folder } : {}) });
  if (!commands.length) return null;
  for (let i = 0; i < 60; i++) {
    const tab = spaces().find((s) => s.id === space)?.tabs.find((t) => !before.has(t.id));
    const terminal = tab && panes().find((p) => p.tab === tab.id && p.terminal)?.terminal;
    if (terminal) {
      for (const line of commands) await hc(["send", terminal, line]);
      return terminal;
    }
    await cx.sleep(100);
  }
  return null;
}

// A template's folder: project templates are relative to the checkout's root.
export function templateFolder(template, scope, top, cwd) {
  if (scope === "project" && template.cwd) return template.cwd.startsWith("/") ? template.cwd : `${top}/${template.cwd}`.replace(/\/+$/, "");
  return cwd || top || undefined;
}
