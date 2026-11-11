// The Changes panel: uncommitted files with checkboxes, the picked file's diff,
// and a commit box (summary + description) that commits only the checked files.
// Derived from Herdr's shipped `changes` mod (Apache-2.0, see ../NOTICE);
// changed to 2code's sidebar Git panel: flat (no card), square status badges,
// selective commit, a description field and translated text.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, shared } from "herdr";
import { t } from "../lib/i18n.js";
import { READ } from "../lib/git.js";
import { ICON } from "../lib/ui.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
const countLines = (text) => (text ? text.split("\n").length - Number(text.endsWith("\n")) : 0);
// Text draws a tab as nothing: pad each to the next 4-column stop.
const untab = (text) => text.replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: untab(line.slice(1)) || " " };
    if (kind === "+") return { kind, number: next++, text: untab(line.slice(1)) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: untab(line.slice(1)) || " " }; }
    return { kind: "", text: line };
  });
}

// 2code's square badges: added green, modified blue, deleted/conflicted red.
const badgeColor = (status, th) => (status === "A" ? th.ansi2 : status === "M" ? th.ansi4 : th.ansi1);

export class Changes {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.excluded = new Set();
    this.summaryState = InputState.new({ placeholder: t("summaryPlaceholder") });
    this.summaryState.on("change", (_e, cx) => this.typed(cx));
    this.summaryState.on("submit", (_e, cx) => this.commit(cx));
    this.summaryState.on("focus", (_e, cx) => { this.focus = "summary"; cx.notify(); });
    this.summaryState.on("blur", (_e, cx) => { if (this.focus === "summary") this.focus = null; cx.notify(); });
    this.bodyState = TextareaState.new({ placeholder: t("descriptionPlaceholder"), rows: 3 });
    this.bodyState.on("focus", (_e, cx) => { this.focus = "body"; cx.notify(); });
    this.bodyState.on("blur", (_e, cx) => { if (this.focus === "body") this.focus = null; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
  }

  typed(cx) {
    const had = Boolean(this.summary?.trim());
    this.summary = this.summaryState.value();
    if (had !== Boolean(this.summary.trim())) cx.notify();
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null; this.excluded = new Set();
      this.setLines([]); this.error = null; this.note = null; this.watched = null; this.limited = false;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.setLines([]); this.open = null; this.error = t("notGit"); return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        const files = [];
        const entries = status.stdout.split("\0").filter(Boolean);
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), fresh = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : fresh || xy.includes("A") ? "A" : "M";
          let stat = stats[path] ?? { add: 0, del: 0 };
          if (fresh && !stat.add && files.length < 200) stat = { ...stat, add: countLines(await readTextFile(`${root}/${path}`, { on }).catch(() => "")) };
          files.push({ path, status: s, fresh, ...stat });
        }
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        for (const path of [...this.excluded]) if (!files.some((f) => f.path === path)) this.excluded.delete(path);
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines([t("diffUnreadable")]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = [t("fileUnreadable")];
      else if (text.includes("\0")) lines = [t("fileBinary")];
      else lines = [`@@ -0,0 +1,${countLines(text)} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map((l) => `+${l}`)];
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? t("binaryChanged") : t("noTextDiff")] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map((line) => (line.length > 4000 ? line.slice(0, 4000) + "…" : line)));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(240, ...this.rows.map((row) => (row.text.length + 1) * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `${t("diffUnreadable")}: ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  included() {
    return this.files.filter((f) => !this.excluded.has(f.path));
  }

  toggle(path, cx) {
    if (this.excluded.has(path)) this.excluded.delete(path); else this.excluded.add(path);
    cx.notify();
  }

  toggleAll(cx) {
    if (this.excluded.size === 0) this.excluded = new Set(this.files.map((f) => f.path));
    else this.excluded = new Set();
    cx.notify();
  }

  // Commits the checked files only: `git add -A -- <paths>` then
  // `git commit -- <paths>`, which leaves the unchecked ones as they were.
  commit(cx) {
    const summary = this.summaryState.value().trim();
    const picked = this.included();
    if (!summary || !picked.length || !this.root || this.busy || this.loading || this.context !== key()) return;
    const body = this.bodyState.value().trim();
    const root = this.root, on = this.on, context = this.context, all = picked.length === this.files.length;
    const paths = picked.map((f) => f.path);
    const message = ["-m", summary, ...(body ? ["-m", body] : [])];
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try {
        const steps = all ? [["add", "-A"], ["commit", ...message]] : [["add", "-A", "--", ...paths], ["commit", ...message, "--", ...paths]];
        for (const args of steps) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
        }
        if (key() === context) { this.summary = ""; this.summaryState.set_value(""); this.bodyState.set_value(""); this.excluded = new Set(); }
      } catch (e) { if (key() === context) this.note = t("commitFailed", { error: String(e?.message ?? e) }); }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  checkbox(id, state, th, onClick) {
    // state: true, false, or "some"
    return div().id(id).size(14).flex_none().flex().items_center().justify_center().rounded(3).cursor_pointer()
      .border_1().border_color(state ? th.solid : th.input).bg(state ? th.solid : th.background).text_color(th.solid_foreground)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .when(state === true, (el) => el.child(svg(`${ICON}/check.svg`).size(11)))
      .when(state === "some", (el) => el.child(div().w(7).h(2).rounded(1).bg(th.solid_foreground)));
  }

  diffRow({ kind, number, text }, th) {
    if (kind === "@") return div().w_full().px(10).h(20).flex_none().truncate().bg(th.raised).text_color(th.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(8).when(kind === "+", (e) => e.bg(th.ansi2 + "18")).when(kind === "-", (e) => e.bg(th.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(th.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  fileRow(f, th) {
    const parts = f.path.split("/"), name = parts.pop(), color = badgeColor(f.status, th);
    return h_flex().id(`change-${f.path}`).h(30).flex_none().mx(4).px(6).gap(8).items_center().rounded(4).cursor_pointer()
      .when(this.open === f.path, (e) => e.bg(th.selected)).hover((s) => s.bg(th.hover))
      .on_click((_e, cx) => this.pick(f.path, cx))
      .child(this.checkbox(`include-${f.path}`, !this.excluded.has(f.path), th, (cx) => this.toggle(f.path, cx)))
      .child(div().flex_none().max_w(150).truncate().text_color(th.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(th.dim).child(parts.join("/")))
      .child(div().size(16).flex_none().flex().items_center().justify_center().rounded(3).border_1().border_color(color + "66").bg(color + "14")
        .text_size(10).font_semibold().text_color(color).child(f.status));
  }

  field(id, focused, th, child) {
    return div().id(id).w_full().px(10).rounded(6).border_1().border_color(focused ? th.accent : th.input).bg(th.background).cursor_text()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(child);
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const th = theme();
    shared("2code.locale");
    const add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const picked = this.included().length;
    const all = picked === this.files.length ? true : picked === 0 ? false : "some";
    const enabled = Boolean(this.summary?.trim() && picked && this.root && !this.busy && !this.loading);
    const label = (text) => div().text_size(12).text_color(th.muted).child(text);
    return v_flex().id("changes").size_full().min_h(0).bg(th.background).text_color(th.foreground).text_size(13)
      .child(h_flex().h(40).flex_none().px(10).gap(8).items_center().border_b(1).border_color(th.border)
        .when(this.files.length > 0, (el) => el.child(this.checkbox("include-all", all, th, (cx) => this.toggleAll(cx))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(th.muted).child(t("changedFiles", { count: this.files.length })))
        .child(div().text_size(11).text_color(th.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(th.ansi1).child(`-${del}`)))
      // overflow_y_scrollbar() wraps the list, so its flex sizing never reached the panel's layout.
      .child(div().flex_1().min_h(44).max_h(this.open ? this.files.length * 30 + 12 : 100000).relative()
        .child(v_flex().id("changes-list").absolute().inset_0().overflow_y_scroll().py(4).children(this.files.map((f) => this.fileRow(f, th)))
          .when(!this.files.length, (e) => e.child(div().p(10).text_size(12).text_color(th.dim).child(this.error || (this.loading && !this.root ? t("changesLoading") : this.root ? t("noChanges") : t("noFolder"))))))
        .child(Scrollbar.vertical("changes-list").absolute().inset_0()))
      .when(this.limited, (el) => el.child(div().px(12).py(4).text_size(11).text_color(th.dim).child(t("changesLimited"))))
      .when(Boolean(this.open), (el) => el.child(div().flex_1().min_h(0).relative().border_t(1).border_color(th.border).font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, th))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())))
      .when(Boolean(this.note), (e) => e.child(div().px(12).py(6).text_size(11).text_color(th.ansi1).child(this.note)))
      .child(v_flex().flex_none().p(10).gap(6).border_t(1).border_color(th.border)
        .child(div().text_size(11).font_semibold().text_color(th.dim).child(t("commitSection").toUpperCase()))
        .child(label(t("summary")))
        .child(this.field("commit-summary", this.focus === "summary", th, Input.new(this.summaryState).h(30).text_size(12).text_color(th.foreground)))
        .child(label(t("description")))
        .child(this.field("commit-body", this.focus === "body", th, Textarea.new(this.bodyState).py(6).text_size(12).text_color(th.foreground)))
        .child(h_flex().pt(2).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(th.dim).child(this.files.length ? t("includedCount", { included: picked, total: this.files.length }) : ""))
          .child(div().id("commit").h(30).px(14).flex().items_center().rounded(6).bg(enabled ? th.solid : th.raised).text_color(enabled ? th.solid_foreground : th.dim).text_size(12)
            .when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? t("committing") : t("commit")))));
  }
}
