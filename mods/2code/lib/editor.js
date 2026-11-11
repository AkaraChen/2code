// Files open as tabs, beside the terminals, as in 2code: each file is a Herdr
// tab whose only pane is the `editor` part. Herdr keeps those tabs (and their
// props) with the space, so open files come back after a restart.
// shared "2code.editors": { [tabId]: { path, on } } maps tabs to files, and
// shared "2code.dirty": { [fileKey]: true } marks unsaved ones.
import { spaces, run, shared, setShared } from "herdr";

export const fileKey = (path, on) => `${on ?? ""}:${path}`;
export const baseName = (path) => path.split(/[\\/]/).pop() || path;

export function editorTabs() {
  const v = shared("2code.editors");
  return v && typeof v === "object" ? v : {};
}

export function editorOf(tabId) {
  return editorTabs()[tabId] ?? null;
}

export function isDirty(path, on) {
  return Boolean((shared("2code.dirty") ?? {})[fileKey(path, on)]);
}

export function setDirty(path, on, dirty) {
  const all = { ...(shared("2code.dirty") ?? {}) }, key = fileKey(path, on);
  if (Boolean(all[key]) === dirty) return;
  if (dirty) all[key] = true; else delete all[key];
  setShared("2code.dirty", all);
}

// Forgets tabs that no longer exist.
export function pruneEditors() {
  const live = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
  const all = editorTabs(), kept = Object.fromEntries(Object.entries(all).filter(([id]) => live.has(id)));
  if (Object.keys(kept).length !== Object.keys(all).length) setShared("2code.editors", kept);
}

// Shows a file: its tab if one is open in the space, else a new tab.
export async function openFile(cx, { space, path, on = null, root }) {
  const s = spaces().find((x) => x.id === space) ?? spaces().find((x) => x.active);
  if (!s) return;
  const mine = new Set(s.tabs.map((t) => t.id));
  const open = Object.entries(editorTabs()).find(([id, e]) => mine.has(id) && e.path === path && (e.on ?? null) === (on ?? null));
  if (open) return run("tab.select", { id: open[0] });
  run("tab.new", { space: s.id, name: baseName(path), mod: "2code", props: { part: "editor", path, on, root } });
  for (let i = 0; i < 40; i++) {
    const tab = spaces().find((x) => x.id === s.id)?.tabs.find((t) => !mine.has(t.id));
    if (tab) { setShared("2code.editors", { ...editorTabs(), [tab.id]: { path, on } }); return; }
    await cx.sleep(50);
  }
}

// Asks the shown editor of a file to save, discard or close (it reads this in render).
export function requestEditor(path, on, action) {
  setShared("2code.editorRequest", { key: fileKey(path, on), action, nonce: Date.now() + Math.random() });
}
