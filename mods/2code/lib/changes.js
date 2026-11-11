// Git work shared by the Changes panel and the diff dialog: what changed,
// a file's diff, commits, discard, push, history. Parts of the status and diff
// reading come from Herdr's shipped `changes` mod (Apache-2.0, see ../NOTICE).
import { exec, readTextFile, appHome } from "herdr";
import * as fs from "fs/promises";
import { git, READ } from "./git.js";

export const countLines = (text) => (text ? text.split("\n").length - Number(text.endsWith("\n")) : 0);
// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
export const isImage = (path) => IMAGE.test(path);

// The working tree's changes: [{ path, from?, status: A|M|D|R|U, fresh, add, del, binary }].
export async function readChanges(root, on, limit = 1000) {
  const run = (args) => exec("git", [...READ, ...args], { cwd: root, on });
  const status = await run(["status", "--porcelain=v1", "-z", "--find-renames", "--untracked-files=all"]);
  if (status.code !== 0) throw new Error(status.stderr);
  const head = await run(["rev-parse", "--verify", "HEAD"]);
  const stats = {};
  const results = head.code === 0
    ? [await run(["diff", "HEAD", "--numstat", "-z", "--find-renames"])]
    : [await run(["diff", "--cached", "--numstat", "-z"]), await run(["diff", "--numstat", "-z"])];
  for (const result of results) {
    if (result.code !== 0) throw new Error(result.stderr);
    // -z numstat: "a\td\tpath\0", or "a\td\t\0old\0new\0" for a rename.
    const parts = result.stdout.split("\0");
    for (let i = 0; i < parts.length; i++) {
      const [a, d, path] = parts[i].split("\t");
      if (a === undefined || d === undefined) continue;
      const name = path || parts[(i += 2)];
      if (!name) continue;
      const old = stats[name] ?? { add: 0, del: 0 };
      stats[name] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
    }
  }
  const entries = status.stdout.split("\0");
  const files = [];
  for (let i = 0; i < entries.length && files.length < limit; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
    const renamed = xy[0] === "R" || xy[1] === "R";
    const from = renamed ? entries[++i] : undefined;
    const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
    const s = conflict ? "U" : renamed ? "R" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
    let stat = stats[path] ?? { add: 0, del: 0 };
    if (fresh && !stat.add && files.length < 200) stat = { ...stat, add: countLines(await readTextFile(`${root}/${path}`, { on }).catch(() => "")) };
    files.push({ path, ...(from ? { from } : {}), status: s, fresh, ...stat });
  }
  return { files, hasHead: head.code === 0, limited: entries.filter(Boolean).length > limit };
}

// A changed file's unified diff lines (from the first hunk), or a note.
export async function fileDiff(root, on, file, hasHead) {
  if (file.fresh || (!hasHead && file.status === "A")) {
    const text = await readTextFile(`${root}/${file.path}`, { on }).catch(() => null);
    if (text === null) return { note: "unreadable" };
    if (text.includes("\0")) return { note: "binary" };
    return { lines: [`@@ -0,0 +1,${countLines(text)} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 3000).map((l) => `+${l}`)] };
  }
  const paths = file.from ? [file.from, file.path] : [file.path];
  const r = await exec("git", [...READ, "diff", ...(hasHead ? ["HEAD"] : []), "--find-renames", "--no-ext-diff", "--no-textconv", "--no-color", "--", ...paths], { cwd: root, on });
  if (r.code !== 0) throw new Error(r.stderr);
  return hunks(r.stdout, file.binary);
}

// A commit's diff of one file.
export async function commitFileDiff(root, on, hash, file) {
  const paths = file.from ? [file.from, file.path] : [file.path];
  const r = await exec("git", [...READ, "show", hash, "--format=", "--find-renames", "--no-ext-diff", "--no-textconv", "--no-color", "--", ...paths], { cwd: root, on });
  if (r.code !== 0) throw new Error(r.stderr);
  return hunks(r.stdout, file.binary);
}

function hunks(text, binary) {
  const all = text.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return { note: binary || /^Binary files /m.test(text) ? "binary" : "empty" };
  return { lines: all.slice(first, first + 3000).map((l) => (l.length > 4000 ? l.slice(0, 4000) + "…" : l)) };
}

// Unified rows: { kind: "@" | "+" | "-" | " ", old?, new?, text }.
export function unifiedRows(lines) {
  let o = 0, n = 0;
  return lines.map((line) => {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { o = +m[1]; n = +m[2]; return { kind: "@", text: line }; }
    const kind = line[0], text = untab(line.slice(1)) || " ";
    if (kind === "-") return { kind, old: o++, text };
    if (kind === "+") return { kind, new: n++, text };
    if (kind === " ") return { kind, old: o++, new: n++, text };
    return { kind: "", text: line };
  });
}

// Side-by-side rows: removed lines pair with the added lines after them.
export function splitRows(rows) {
  const out = [];
  let minus = [], plus = [];
  const flush = () => {
    for (let i = 0; i < Math.max(minus.length, plus.length); i++) out.push({ left: minus[i] ?? null, right: plus[i] ?? null });
    minus = []; plus = [];
  };
  for (const r of rows) {
    if (r.kind === "-") minus.push(r);
    else if (r.kind === "+") plus.push(r);
    else { flush(); out.push(r.kind === "@" || r.kind === "" ? { hunk: r } : { left: r, right: r }); }
  }
  flush();
  return out;
}

// Commits the given files only (all of them: plain add -A + commit).
export async function commit(root, on, paths, all, summary, body) {
  const message = ["-m", summary, ...(body ? ["-m", body] : [])];
  const steps = all ? [["add", "-A"], ["commit", ...message]] : [["add", "-A", "--", ...paths], ["commit", ...message, "--", ...paths]];
  for (const args of steps) {
    const r = await exec("git", args, { cwd: root, on });
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
  }
}

// Throws away a file's changes: back to HEAD, or deleted if git never had it.
export async function discard(root, on, file, hasHead) {
  const r = file.fresh
    ? await exec("git", ["clean", "-f", "--", file.path], { cwd: root, on })
    : hasHead
      ? await exec("git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...(file.from ? [file.from, file.path] : [file.path])], { cwd: root, on })
      : await exec("git", ["rm", "--cached", "-f", "-q", "--", file.path], { cwd: root, on });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
}

// How far the branch is ahead of its upstream (or of every remote when it has none).
export async function ahead(root, on) {
  const up = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], on);
  const r = await git(root, ["rev-list", "--count", ...(up.ok ? ["@{u}..HEAD"] : ["HEAD", "--not", "--remotes"])], on);
  return { count: r.ok ? Number(r.out) || 0 : 0, upstream: up.ok ? up.out : null };
}

export async function push(root, on, upstream) {
  const r = await exec("git", upstream ? ["push"] : ["push", "-u", "origin", "HEAD"], { cwd: root, on, timeout: 300_000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
}

// The last commits: [{ hash, short, subject, author, when }].
export async function history(root, on, count = 200) {
  const r = await git(root, ["log", `-${count}`, "--format=%H%x1f%h%x1f%s%x1f%an%x1f%cr"], on);
  if (!r.ok) return [];
  return r.out.split("\n").filter(Boolean).map((l) => { const [hash, short, subject, author, when] = l.split("\x1f"); return { hash, short, subject, author, when }; });
}

// A commit's files: [{ path, from?, status, add, del, binary }].
export async function commitFiles(root, on, hash) {
  const names = await git(root, ["show", hash, "--format=", "--name-status", "--find-renames", "-z"], on);
  const nums = await git(root, ["show", hash, "--format=", "--numstat", "--find-renames", "-z"], on);
  const stats = {};
  const np = nums.out.split("\0");
  for (let i = 0; i < np.length; i++) {
    const [a, d, path] = np[i].split("\t");
    if (a === undefined || d === undefined) continue;
    const name = path || np[(i += 2)];
    if (name) stats[name] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  const out = [], parts = names.out.split("\0").filter((x) => x !== "");
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!/^[A-Z]/.test(code)) continue;
    if (code[0] === "R" || code[0] === "C") { const from = parts[++i], path = parts[++i]; out.push({ path, from, status: "R", ...(stats[path] ?? { add: 0, del: 0 }) }); }
    else { const path = parts[++i]; out.push({ path, status: code[0] === "A" ? "A" : code[0] === "D" ? "D" : "M", ...(stats[path] ?? { add: 0, del: 0 }) }); }
  }
  return out;
}

// For image diffs: writes the old (HEAD or a commit's parent) and new versions
// into the mod's hidden cache and returns paths for image(). This computer only.
export async function imageVersions(root, cacheDir, cacheRel, file, rev = "HEAD", next = null) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ext = file.path.split(".").pop();
  const before = `${cacheDir}/${id}-a.${ext}`, after = `${cacheDir}/${id}-b.${ext}`;
  await exec("mkdir", ["-p", cacheDir]);
  const out = {};
  if (file.status !== "A") {
    const r = await exec("sh", ["-c", 'git show "$1:$2" > "$3"', "x", rev, file.from ?? file.path, before], { cwd: root });
    if (r.code === 0) out.before = `${cacheRel}/${id}-a.${ext}`;
  }
  if (file.status !== "D") {
    const r = next
      ? await exec("sh", ["-c", 'git show "$1:$2" > "$3"', "x", next, file.path, after], { cwd: root })
      : await exec("cp", [`${root}/${file.path}`, after]);
    if (r.code === 0) out.after = `${cacheRel}/${id}-b.${ext}`;
  }
  return out;
}

// An image's pixel size from its header (PNG, GIF, JPEG), or null.
export async function imageSize(rel) {
  let b;
  try { b = await fs.readFile(`${appHome()}/${rel}`); } catch { return null; }
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, h: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0 };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | b[7] << 8, h: b[8] | b[9] << 8 };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b[i + 2] << 8 | b[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b[i + 7] << 8 | b[i + 8], h: b[i + 5] << 8 | b[i + 6] };
      i += 2 + len;
    }
  }
  return null;
}

// Scales a size into a box, keeping its shape; unknown sizes get the box.
export function fit(size, maxW, maxH) {
  if (!size?.w || !size?.h) return { w: maxW, h: maxH };
  const k = Math.min(1, maxW / size.w, maxH / size.h);
  return { w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
}
