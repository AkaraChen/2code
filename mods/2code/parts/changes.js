// The Changes panel, like 2code's sidebar Git panel: changed files with
// checkboxes, the picked file's diff, a commit box (summary + description) that
// commits only the checked files, discard per file, push, and a button that
// opens the large diff dialog. Started from Herdr's shipped `changes` mod
// (Apache-2.0, see ../NOTICE).
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, settings, shared, openOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { readChanges, fileDiff, unifiedRows, commit, discard, ahead, push } from "../lib/changes.js";
import { ICON, icon } from "../lib/ui.js";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

// 2code's square badges: added green, modified / renamed blue, deleted and conflicted red.
export const badgeColor = (status, th) => (status === "A" ? th.ansi2 : status === "M" || status === "R" ? th.ansi4 : th.ansi1);

export function badge(status, th) {
  const color = badgeColor(status, th);
  return div().size(16).flex_none().flex().items_center().justify_center().rounded(3).border_1().border_color(color + "66").bg(color + "14")
    .text_size(10).font_semibold().text_color(color).child(status);
}

export function checkbox(id, state, th, onClick) {
  // state: true, false or "some"
  return div().id(id).size(14).flex_none().flex().items_center().justify_center().rounded(3).cursor_pointer()
    .border_1().border_color(state ? th.solid : th.input).bg(state ? th.solid : th.background).text_color(th.solid_foreground)
    .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
    .when(state === true, (el) => el.child(svg(`${ICON}/check.svg`).size(11)))
    .when(state === "some", (el) => el.child(div().w(7).h(2).rounded(1).bg(th.solid_foreground)));
}

export class Changes {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.excluded = new Set(); this.ahead = { count: 0, upstream: null };
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
      this.context = context; this.root = null; this.files = []; this.open = null; this.excluded = new Set(); this.confirm = null;
      this.rows = []; this.error = null; this.note = null; this.watched = null; this.limited = false; this.ahead = { count: 0, upstream: null };
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.rows = []; this.open = null; this.error = t("notGit"); return; }
        const root = top.stdout.trim();
        const { files, hasHead, limited } = await readChanges(root, on);
        const a = await ahead(root, on);
        if (key() !== context) return;
        this.root = root; this.on = on; this.hasHead = hasHead; this.files = files; this.limited = limited; this.error = null; this.ahead = a;
        for (const path of [...this.excluded]) if (!files.some((f) => f.path === path)) this.excluded.delete(path);
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.rows = []; }
        if (this.open) await this.load(this.open, context);
      } catch (e) { if (key() === context) this.error = String(e?.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path);
    if (!file) return;
    try {
      const d = await fileDiff(this.root, this.on, file, this.hasHead);
      const lines = d.lines ?? [t(d.note === "binary" ? "binaryChanged" : d.note === "unreadable" ? "fileUnreadable" : "noTextDiff")];
      if (key() !== context || this.open !== path) return;
      this.rows = unifiedRows(lines);
      this.diffWidth = Math.max(240, ...this.rows.map((row) => (row.text.length + 1) * 7 + 50));
    } catch { if (key() === context && this.open === path) this.rows = unifiedRows([t("diffUnreadable")]); }
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.rows = []; this.note = null;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => { await this.load(path, context); cx.notify(); });
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
    this.excluded = this.excluded.size === 0 ? new Set(this.files.map((f) => f.path)) : new Set();
    cx.notify();
  }

  // Runs a git change, then refreshes; failures show under the list.
  act(cx, work) {
    if (this.busy || !this.root) return;
    const context = this.context;
    this.busy = true; this.note = null;
    cx.spawn(async (cx) => {
      try { await work(); }
      catch (e) { if (key() === context) this.note = String(e?.message ?? e); }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  commit(cx) {
    const summary = this.summaryState.value().trim(), picked = this.included();
    if (!summary || !picked.length || this.loading || this.context !== key()) return;
    const body = this.bodyState.value().trim(), all = picked.length === this.files.length, root = this.root, on = this.on;
    this.act(cx, async () => {
      try { await commit(root, on, picked.flatMap((f) => (f.from ? [f.from, f.path] : [f.path])), all, summary, body); }
      catch (e) { throw new Error(t("commitFailed", { error: String(e?.message ?? e) })); }
      this.summary = ""; this.summaryState.set_value(""); this.bodyState.set_value(""); this.excluded = new Set();
    });
  }

  // Discarding asks once: the first click arms the button, the second discards.
  discard(f, cx) {
    if (this.confirm !== f.path) { this.confirm = f.path; cx.notify(); return; }
    this.confirm = null;
    const root = this.root, on = this.on, hasHead = this.hasHead;
    this.act(cx, async () => {
      try { await discard(root, on, f, hasHead); }
      catch (e) { throw new Error(t("discardFailed", { error: String(e?.message ?? e) })); }
    });
  }

  push(cx) {
    const root = this.root, on = this.on, upstream = this.ahead.upstream;
    this.act(cx, async () => {
      try { await push(root, on, upstream); }
      catch (e) { throw new Error(t("pushFailed", { error: String(e?.message ?? e) })); }
    });
  }

  diffRow(r, th) {
    if (r.kind === "@" || r.kind === "") return div().w_full().px(10).h(20).flex_none().truncate().bg(th.raised).text_color(th.dim).child(r.text);
    return h_flex().w_full().h(20).flex_none().gap(8).when(r.kind === "+", (e) => e.bg(th.ansi2 + "18")).when(r.kind === "-", (e) => e.bg(th.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(th.dim).child(String(r.new ?? r.old ?? "")))
      .child(div().flex_1().min_w(0).truncate().child(r.text));
  }

  fileRow(f, th) {
    const parts = f.path.split("/"), name = parts.pop(), arming = this.confirm === f.path, hovered = this.hoverRow === f.path;
    return h_flex().id(`change-${f.path}`).h(30).flex_none().mx(4).px(6).gap(8).items_center().rounded(4).cursor_pointer()
      .when(this.open === f.path, (e) => e.bg(th.selected)).hover((s) => s.bg(th.hover))
      .on_click((_e, cx) => this.pick(f.path, cx))
      .on_hover((h, cx) => {
        if (h) this.hoverRow = f.path;
        else if (this.hoverRow === f.path) { this.hoverRow = null; if (this.confirm === f.path) this.confirm = null; }
        cx.notify();
      })
      .child(checkbox(`include-${f.path}`, !this.excluded.has(f.path), th, (cx) => this.toggle(f.path, cx)))
      .child(div().flex_none().max_w(150).truncate().text_color(th.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(th.dim).child(f.from ? `← ${f.from}` : parts.join("/")))
      .when(hovered || arming, (el) => el.child(div().id(`discard-${f.path}`).h(18).px(arming ? 6 : 3).flex().items_center().justify_center().rounded(4)
        .text_size(11).text_color(arming ? th.ansi1 : th.dim).when(arming, (e) => e.bg(th.ansi1 + "14"))
        .hover((s) => s.text_color(th.ansi1)).tooltip(t("discardChanges"))
        .on_click((_e, cx) => { cx.stop_propagation(); this.discard(f, cx); })
        .child(arming ? t("discardConfirm") : icon("undo", 12))))
      .child(badge(f.status, th));
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
    const field = (id, focused, child) => div().id(id).w_full().px(10).rounded(6).border_1().border_color(focused ? th.accent : th.input).bg(th.background).cursor_text()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(child);
    return v_flex().id("changes").size_full().min_h(0).bg(th.background).text_color(th.foreground).text_size(13)
      .child(h_flex().h(40).flex_none().px(10).gap(8).items_center().border_b(1).border_color(th.border)
        .when(this.files.length > 0, (el) => el.child(checkbox("include-all", all, th, (cx) => this.toggleAll(cx))))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(th.muted).child(t("changedFiles", { count: this.files.length })))
        .child(div().text_size(11).text_color(th.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(th.ansi1).child(`-${del}`))
        .child(div().id("open-diff").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(th.dim)
          .hover((s) => s.bg(th.hover).text_color(th.foreground))
          .on_click(() => openDiffDialog())
          .child(icon("maximize", 13))))
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
        .child(field("commit-summary", this.focus === "summary", Input.new(this.summaryState).h(30).text_size(12).text_color(th.foreground)))
        .child(label(t("description")))
        .child(field("commit-body", this.focus === "body", Textarea.new(this.bodyState).py(6).text_size(12).text_color(th.foreground)))
        .child(h_flex().pt(2).gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(th.dim).child(this.files.length ? t("includedCount", { included: picked, total: this.files.length }) : ""))
          .when(this.ahead.count > 0, (el) => el.child(div().id("push").h(30).px(12).flex().items_center().gap(5).rounded(6).border_1().border_color(th.input).cursor_pointer()
            .text_size(12).hover((s) => s.bg(th.hover)).on_click((_e, cx) => this.push(cx))
            .child(icon("arrow-up", 13)).child(t("pushCount", { count: this.ahead.count }))))
          .child(div().id("commit").h(30).px(14).flex().items_center().rounded(6).bg(enabled ? th.solid : th.raised).text_color(enabled ? th.solid_foreground : th.dim).text_size(12)
            .when(enabled, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? t("committing") : t("commit")))));
  }
}

export function openDiffDialog(tab = "changes") {
  openOverlay({ mod: "2code", kind: "dialog", width: 0.92, height: 0.88, props: { part: "diff", tab } });
}
