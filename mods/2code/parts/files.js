// The Files panel: a lazy tree of the focused folder with git colors and a
// read-only preview. Derived from Herdr's shipped `files` mod (Apache-2.0,
// see ../NOTICE); changed to 2code's flat look (no card), 2code's git colors,
// folder change dots and translated text.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, shared } from "herdr";
import { t } from "../lib/i18n.js";
import { READ } from "../lib/git.js";
import { icon } from "../lib/ui.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// 2code's git colors: new files green, modified blue, deleted and conflicted red.
const markColor = (mark, th) => (mark === "U" || mark === "A" ? th.ansi2 : mark === "D" || mark === "C" ? th.ansi1 : th.ansi4);

export class Files {
  init(_props, cx) {
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {}; this.dirty = new Set();
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async (cx) => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.dirty = new Set(); this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {}, dirty = new Set();
        if (top?.code === 0) {
          const root = top.stdout.trim();
          const status = await exec("git", [...READ, "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2), path = `${root}/${entry.slice(3)}`;
            marks[path] = xy === "??" ? "U" : xy.includes("U") || xy === "AA" || xy === "DD" ? "C" : xy.includes("A") ? "A" : xy.includes("D") ? "D" : "M";
            for (let at = path.lastIndexOf("/"); at > root.length; at = path.lastIndexOf("/", at - 1)) dirty.add(path.slice(0, at));
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.dirty = dirty; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async (cx) => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = t("fileGone"); return; }
        if (text.includes("\0")) { this.fileError = t("fileBinary"); return; }
        const th = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: th.ansi5, string: th.ansi2, comment: th.dim, function: th.ansi4, type: th.ansi3, number: th.ansi1, constant: th.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = t("fileUnreadable"); }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, th) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path);
      const abs = `${this.root}/${path}`, mark = this.marks[abs], changed = entry.dir && this.dirty.has(abs);
      out.push(h_flex().id(`file-${path}`).h(24).flex_none().mx(4).pl(4 + depth * 12).pr(6).gap(5).items_center().rounded(4).cursor_pointer()
        .text_color(mark ? markColor(mark, th) : th.muted).hover((s) => s.bg(th.hover).text_color(mark ? markColor(mark, th) : th.foreground))
        .on_click((_e, cx) => (entry.dir ? this.toggle(path, cx) : this.show(path, cx)))
        .child(entry.dir ? icon(open ? "chevron-down" : "chevron-right", 12).text_color(th.dim) : div().w(12).flex_none())
        .child(icon(entry.dir ? "folder" : "file", 14).text_color(th.dim))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(changed, (el) => el.child(div().size(6).flex_none().rounded(3).bg(th.ansi4)))
        .when(Boolean(mark), (el) => el.child(div().w(12).flex_none().text_right().text_size(11).font_semibold().child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, th);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key) this.refresh(cx);
    const th = theme();
    shared("2code.locale");
    return v_flex().id("files").size_full().min_h(0).bg(th.background).text_color(th.foreground).text_size(13)
      .when(Boolean(this.file), (el) => el
        .child(h_flex().h(36).flex_none().px(8).gap(6).items_center().border_b(1).border_color(th.border)
          .child(div().id("files-back").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(th.dim)
            .hover((s) => s.bg(th.hover).text_color(th.foreground))
            .on_click((_e, cx) => { this.show(null); cx.notify(); })
            .child(svg("mods/2code/icons/chevron-left.svg").size(14)))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(th.muted).child(this.file)))
        .child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(th.dim).child(this.fileError || t("fileLoading"))))
      .when(!this.file, (el) => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().py(4).children(this.rows("", 0, [], th))
        .when(Boolean(this.error) || !this.entries.get("")?.length, (el) => el.child(div().p(10).text_size(12).text_color(th.dim).child(this.error || (this.loading ? t("filesLoading") : this.root ? t("filesEmpty") : t("noFolder")))))
        .when(this.limited, (el) => el.child(div().p(10).text_size(11).text_color(th.dim).child(t("filesLimited"))))));
  }
}
