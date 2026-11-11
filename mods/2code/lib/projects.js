// The project list: the only thing 2code keeps. Each entry is a folder (a repo's
// main checkout) and the machine it's on, plus an optional name the person gave
// it; everything else is derived. Stored in Herdr's shared state, which is
// persisted and redraws every mod when it changes.
import { shared, setShared } from "herdr";
import { git } from "./git.js";

const KEY = "2code.projects";

export const projectKey = (p) => `${p.machine ?? ""}:${p.path}`;
// A bare repo's folder ("app.git", "bare.git", ".bare") says little: use "app"
// or the folder around it.
export function projectName(p) {
  if (p.name) return p.name;
  const parts = p.path.split(/[\\/]/).filter(Boolean);
  const last = parts.pop() ?? p.path, stem = last.replace(/\.git$/, "");
  if (stem && stem !== "bare" && stem !== ".bare" && stem !== last) return stem;
  if (stem === "bare" || stem === ".bare" || stem === "") return parts.pop() ?? last;
  return last;
}
const same = (a, b) => a.path === b.path && (a.machine ?? null) === (b.machine ?? null);

export function savedProjects() {
  const v = shared(KEY);
  return Array.isArray(v) ? v.filter((p) => p && typeof p.path === "string") : [];
}

export function addProject(path, machine = null) {
  const list = savedProjects();
  if (!path || list.some((p) => same(p, { path, machine }))) return;
  setShared(KEY, [...list, { path, machine: machine ?? null }]);
}

export function removeProject(path, machine = null) {
  setShared(KEY, savedProjects().filter((p) => !same(p, { path, machine })));
}

export function renameProject(path, machine, name) {
  setShared(KEY, savedProjects().map((p) => (same(p, { path, machine }) ? { path: p.path, machine: p.machine ?? null, ...(name?.trim() ? { name: name.trim() } : {}) } : p)));
}

// Every checkout of a repo (`git worktree list`): { path, branch, main }, the
// main checkout first. A folder outside git is its own single checkout.
export async function checkouts(path, on) {
  const r = await git(path, ["worktree", "list", "--porcelain"], on);
  if (!r.ok) return [{ path, branch: null, main: true }];
  const out = [];
  for (const block of r.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const at = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!at || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path: at, branch, main: out.length === 0 });
  }
  return out.length ? out : [{ path, branch: null, main: true }];
}
