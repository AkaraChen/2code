// The diff dialog (Cmd/Ctrl+G or the panel's expand button), like 2code's:
// Changes (checkboxes, discard, commit, push) and History (commits → files),
// a unified or split diff, image before/after, and review comments: select
// lines, comment, collect them, copy them for an agent.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, Scrollbar, v_virtual_list } from "gpui-base";
import { props, theme, settings, shared, setShared, appHome, openOverlay, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { git, here } from "../lib/git.js";
import { readChanges, fileDiff, commitFileDiff, unifiedRows, splitRows, commit, discard, ahead, push, history, commitFiles, isImage, imageVersions, imageSize, fit } from "../lib/changes.js";
import { icon } from "../lib/ui.js";
import { badge, checkbox } from "./changes.js";

const ROW = 20;

export function reviewList(root) {
  const all = shared("2code.review");
  return (all && typeof all === "object" && Array.isArray(all[root])) ? all[root] : [];
}
export function setReviewList(root, list) {
  const all = { ...(shared("2code.review") ?? {}) };
  if (list.length) all[root] = list; else delete all[root];
  setShared("2code.review", all);
}

export class Diff {
  init(p, cx) {
    const { cwd, on } = here();
    this.cwd = cwd; this.on = on;
    this.tab = p.tab === "history" ? "history" : "changes";
    this.view = localStorage.getItem("view") === "split" ? "split" : "unified";
    this.files = []; this.excluded = new Set(); this.commits = []; this.commit = null; this.commitFiles = [];
    this.file = null; this.rows = []; this.split = []; this.note = null; this.images = null; this.sel = null;
    this.ahead = { count: 0, upstream: null };
    this.summary = InputState.new({ placeholder: t("summaryPlaceholder") });
    this.summary.on("change", (_e, cx) => cx.notify());
    this.summary.on("submit", (_e, cx) => this.doCommit(cx));
    this.body = TextareaState.new({ placeholder: t("descriptionPlaceholder"), rows: 3 });
    this.comment = InputState.new({ placeholder: t("commentPlaceholder") });
    this.comment.on("submit", (_e, cx) => this.addComment(cx));
    // Shift-click extends a selection; virtual list clicks carry no modifiers,
    // so the dialog keeps the keyboard and follows Shift itself.
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.shift = false;
    cx.spawn(async (cx) => {
      const top = await git(cwd, ["rev-parse", "--show-toplevel"], on);
      if (!top.ok) { this.error = t("notGit"); cx.notify(); return; }
      this.root = top.out;
      this.branch = (await git(this.root, ["branch", "--show-current"], on)).out || "HEAD";
      await this.reload(cx);
    });
  }

  async reload(cx) {
    try {
      const { files, hasHead } = await readChanges(this.root, this.on);
      this.files = files; this.hasHead = hasHead;
      for (const path of [...this.excluded]) if (!files.some((f) => f.path === path)) this.excluded.delete(path);
      this.ahead = await ahead(this.root, this.on);
      if (this.tab === "history" && !this.commits.length) this.commits = await history(this.root, this.on);
      if (this.tab === "changes" && this.file && !this.commit && !files.some((f) => f.path === this.file.path)) this.showFile(null);
      if (this.tab === "changes" && !this.file && files.length) await this.openFile(files[0], cx);
    } catch (e) { this.error = String(e?.message ?? e); }
    cx.notify();
  }

  showFile(f) {
    this.file = f; this.rows = []; this.split = []; this.note = null; this.images = null; this.sel = null;
  }

  async openFile(f, cx) {
    this.showFile(f);
    cx.notify();
    if (!f) return;
    try {
      if (isImage(f.path) && !this.on) {
        const cacheRel = "mods/2code/.cache/diff", cacheDir = `${appHome()}/${cacheRel}`;
        this.images = this.commit
          ? await imageVersions(this.root, cacheDir, cacheRel, f, `${this.commit.hash}^`, this.commit.hash)
          : await imageVersions(this.root, cacheDir, cacheRel, f, "HEAD");
        for (const k of ["before", "after"]) if (this.images[k]) this.images[k] = { rel: this.images[k], ...fit(await imageSize(this.images[k]), 360, 220) };
      }
      const d = this.commit ? await commitFileDiff(this.root, this.on, this.commit.hash, f) : await fileDiff(this.root, this.on, f, this.hasHead);
      if (this.file !== f) return;
      if (d.lines) {
        this.rows = unifiedRows(d.lines).map((r, idx) => ({ ...r, idx }));
        this.split = splitRows(this.rows);
      } else this.note = t(d.note === "binary" ? "binaryChanged" : d.note === "unreadable" ? "fileUnreadable" : "noTextDiff");
    } catch (e) { this.note = `${t("diffUnreadable")}: ${e?.message ?? e}`; }
    cx.notify();
  }

  setTab(tab, cx) {
    this.tab = tab; this.commit = null; this.commitFiles = []; this.showFile(null);
    cx.spawn(async (cx) => { await this.reload(cx); });
    cx.notify();
  }

  pickCommit(c, cx) {
    this.commit = c; this.commitFiles = []; this.showFile(null);
    cx.spawn(async (cx) => {
      this.commitFiles = await commitFiles(this.root, this.on, c.hash);
      if (this.commit === c && this.commitFiles.length) await this.openFile(this.commitFiles[0], cx);
      cx.notify();
    });
    cx.notify();
  }

  setView(view) {
    this.view = view; localStorage.setItem("view", view); this.sel = null;
  }

  // Git changes from the dialog, then a reload; errors show in the footer.
  act(cx, work, failKey) {
    if (this.busy || !this.root) return;
    this.busy = true; this.error = null;
    cx.spawn(async (cx) => {
      try { await work(); }
      catch (e) { this.error = t(failKey, { error: String(e?.message ?? e) }); }
      finally { this.busy = false; await this.reload(cx); }
    });
    cx.notify();
  }

  doCommit(cx) {
    const summary = this.summary.value().trim(), picked = this.files.filter((f) => !this.excluded.has(f.path));
    if (!summary || !picked.length) return;
    const body = this.body.value().trim(), all = picked.length === this.files.length;
    this.act(cx, async () => {
      await commit(this.root, this.on, picked.flatMap((f) => (f.from ? [f.from, f.path] : [f.path])), all, summary, body);
      this.summary.set_value(""); this.body.set_value(""); this.excluded = new Set(); this.showFile(null);
    }, "commitFailed");
  }

  doDiscard(f, cx) {
    if (this.confirm !== f.path) { this.confirm = f.path; cx.notify(); return; }
    this.confirm = null;
    this.act(cx, async () => { await discard(this.root, this.on, f, this.hasHead); if (this.file?.path === f.path) this.showFile(null); }, "discardFailed");
  }

  doPush(cx) {
    this.act(cx, () => push(this.root, this.on, this.ahead.upstream), "pushFailed");
  }

  // Line selection: click a line, shift-click to extend.
  selectKey(key, cx) {
    const [kind, n] = key.split(":"), i = Number(n);
    const row = kind === "u" ? this.rows[i] : (this.split[i]?.right ?? this.split[i]?.left);
    if (row) this.select(row, cx);
  }

  select(row, cx) {
    if (!row || row.kind === "@" || row.kind === "") return;
    // Click a line, then another to make it a range (or shift-click); a third
    // click starts over.
    const single = this.sel && this.sel.a === this.sel.b;
    this.sel = this.sel && (this.shift || (single && row.idx !== this.sel.a)) ? { a: this.sel.a, b: row.idx } : { a: row.idx, b: row.idx };
    cx.notify();
    cx.spawn(async () => { this.comment.focus(); });
  }

  selected() {
    if (!this.sel) return [];
    const lo = Math.min(this.sel.a, this.sel.b), hi = Math.max(this.sel.a, this.sel.b);
    return this.rows.slice(lo, hi + 1).filter((r) => r.kind !== "@" && r.kind !== "");
  }

  rangeLabel(rows) {
    const nums = rows.map((r) => r.new ?? r.old).filter((n) => n !== undefined);
    if (!nums.length) return "";
    const a = Math.min(...nums), b = Math.max(...nums);
    return a === b ? `${a}` : `${a}-${b}`;
  }

  addComment(cx) {
    const text = this.comment.value().trim(), rows = this.selected();
    if (!text || !rows.length || !this.file) return;
    const list = reviewList(this.root);
    setReviewList(this.root, [...list, { file: this.file.path, range: this.rangeLabel(rows), code: rows.map((r) => `${r.kind === " " ? " " : r.kind}${r.text}`).join("\n"), body: text }]);
    this.comment.set_value(""); this.sel = null;
    cx.notify();
  }

  // ---- drawing ----

  lineRow(r, th, selected) {
    if (r.kind === "@" || r.kind === "") return div().w_full().px(10).h(ROW).flex_none().truncate().bg(th.raised).text_color(th.dim).child(r.text);
    return h_flex().w_full().h(ROW).flex_none().gap(8).cursor_pointer()
      .when(r.kind === "+", (e) => e.bg(th.ansi2 + "18")).when(r.kind === "-", (e) => e.bg(th.ansi1 + "18"))
      .when(selected, (e) => e.bg(th.selection))
      .child(div().w(36).flex_none().text_right().text_color(th.dim).child(r.old === undefined ? "" : String(r.old)))
      .child(div().w(36).flex_none().text_right().text_color(th.dim).child(r.new === undefined ? "" : String(r.new)))
      .child(div().w(10).flex_none().text_color(th.dim).child(r.kind === " " ? "" : r.kind))
      .child(div().flex_1().min_w(0).whitespace_nowrap().child(r.text));
  }

  splitCell(r, side, th, selected) {
    if (!r) return div().flex_1().min_w(0).h_full().bg(th.raised + "80");
    const num = side === "left" ? r.old : r.new;
    const mark = side === "left" ? r.kind === "-" : r.kind === "+";
    return h_flex().flex_1().min_w(0).h_full().gap(8).overflow_hidden().cursor_pointer()
      .when(mark, (e) => e.bg((side === "left" ? th.ansi1 : th.ansi2) + "18"))
      .when(selected, (e) => e.bg(th.selection))
      .child(div().w(36).flex_none().text_right().text_color(th.dim).child(num === undefined ? "" : String(num)))
      .child(div().flex_1().min_w(0).whitespace_nowrap().child(r.text));
  }

  diffBody(th) {
    if (!this.file) return div().p(16).text_color(th.dim).child(this.tab === "history" && !this.commit ? t("pickCommit") : t("selectFile"));
    const lo = this.sel ? Math.min(this.sel.a, this.sel.b) : -1, hi = this.sel ? Math.max(this.sel.a, this.sel.b) : -2;
    const inSel = (r) => r && r.idx >= lo && r.idx <= hi;
    const font = settings().font_family ?? "JetBrains Mono";
    return v_flex().flex_1().min_h(0)
      .when(Boolean(this.images), (el) => el.child(h_flex().p(12).gap(12).items_start().border_b(1).border_color(th.border)
        .children([["before", t("before")], ["after", t("after")]].map(([k, label]) => v_flex().flex_1().min_w(0).gap(6)
          .child(div().text_size(11).text_color(th.dim).child(label))
          .child(this.images[k] ? image(this.images[k].rel).w(this.images[k].w).h(this.images[k].h).flex_none() : div().h(60).text_color(th.dim).child("—"))))))
      .when(Boolean(this.note) && !this.images, (el) => el.child(div().p(16).text_color(th.dim).child(this.note)))
      .when(!this.note, (el) => el.child(div().flex_1().min_h(0).relative().font_family(font).text_size(12)
        .child(this.view === "split"
          ? v_virtual_list("diff-split", this.split.length, ROW, (i) => `s:${i}`, (range) => this.split.slice(range.start, range.end).map((x) =>
            x.hunk ? div().w_full().px(10).h(ROW).flex_none().truncate().bg(th.raised).text_color(th.dim).child(x.hunk.text)
              : h_flex().w_full().h(ROW).flex_none().child(this.splitCell(x.left, "left", th, inSel(x.left))).child(div().w(1).h_full().bg(th.border)).child(this.splitCell(x.right, "right", th, inSel(x.right))))).on_item_click((key, cx) => this.selectKey(key, cx)).absolute().inset_0()
          // Nested flex leaves size_full() with no height here; pin to the box instead.
          : div().id("diff-x").absolute().inset_0().overflow_x_scrollbar().child(div().w_full().min_w(Math.max(400, ...this.rows.map((r) => r.text.length * 7.3 + 120))).h_full()
            .child(v_virtual_list("diff-unified", this.rows.length, ROW, (i) => `u:${i}`, (range) => this.rows.slice(range.start, range.end).map((r) => this.lineRow(r, th, inSel(r)))).on_item_click((key, cx) => this.selectKey(key, cx)).size_full())))
        .child(Scrollbar.vertical(this.view === "split" ? "diff-split" : "diff-unified").viewport_from_layout().absolute().inset_0())))
      .when(this.selected().length > 0, (el) => el.child(h_flex().p(10).gap(8).items_center().border_t(1).border_color(th.border).bg(th.raised)
        .child(icon("message", 14).text_color(th.muted))
        .child(v_flex().flex_none().max_w(260)
          .child(div().truncate().text_size(12).text_color(th.muted).child(`${this.file.path.split("/").pop()}:${this.rangeLabel(this.selected())}`))
          .when(this.sel && this.sel.a === this.sel.b, (e) => e.child(div().text_size(10.5).text_color(th.dim).child(t("extendHint")))))
        .child(div().flex_1().px(10).rounded(6).border_1().border_color(th.accent).bg(th.background).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.comment).h(30).text_size(12.5).text_color(th.foreground)))
        .child(div().id("add-comment").h(30).px(12).flex().items_center().rounded(6).bg(th.solid).text_color(th.solid_foreground).text_size(12).cursor_pointer()
          .on_click((_e, cx) => this.addComment(cx)).child(t("addComment")))
        .child(div().id("clear-sel").size(24).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(th.dim)
          .on_click((_e, cx) => { this.sel = null; cx.notify(); }).child(icon("x", 12)))));
  }

  fileRow(f, th, { selectable }) {
    const parts = f.path.split("/"), name = parts.pop(), active = this.file?.path === f.path, arming = this.confirm === f.path;
    return h_flex().id(`f-${f.path}`).h(30).flex_none().mx(4).px(6).gap(8).items_center().rounded(4).cursor_pointer()
      .bg(active ? th.selected : th.background).hover((s) => s.bg(th.hover))
      .on_click((_e, cx) => cx.spawn(async (cx) => { await this.openFile(f, cx); }))
      .on_hover((h, cx) => { this.hoverRow = h ? f.path : (this.hoverRow === f.path ? null : this.hoverRow); if (!h && arming) this.confirm = null; cx.notify(); })
      .when(selectable, (el) => el.child(checkbox(`inc-${f.path}`, !this.excluded.has(f.path), th, (cx) => { if (this.excluded.has(f.path)) this.excluded.delete(f.path); else this.excluded.add(f.path); cx.notify(); })))
      .child(div().flex_none().max_w(170).truncate().text_color(th.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(th.dim).child(f.from ? `← ${f.from}` : parts.join("/")))
      .child(div().flex_none().text_size(11).text_color(th.ansi2).child(f.add ? `+${f.add}` : ""))
      .child(div().flex_none().text_size(11).text_color(th.ansi1).child(f.del ? `-${f.del}` : ""))
      .when(selectable && (this.hoverRow === f.path || arming), (el) => el.child(div().id(`d-${f.path}`).h(18).px(arming ? 6 : 3).flex().items_center().rounded(4)
        .text_size(11).text_color(arming ? th.ansi1 : th.dim).when(arming, (e) => e.bg(th.ansi1 + "14")).hover((s) => s.text_color(th.ansi1)).tooltip(t("discardChanges"))
        .on_click((_e, cx) => { cx.stop_propagation(); this.doDiscard(f, cx); })
        .child(arming ? t("discardConfirm") : icon("undo", 12))))
      .child(badge(f.status, th));
  }

  changesList(th) {
    const picked = this.files.filter((f) => !this.excluded.has(f.path)).length;
    const all = picked === this.files.length ? true : picked === 0 ? false : "some";
    const ok = Boolean(this.summary.value().trim() && picked && !this.busy);
    const field = (child) => div().w_full().px(10).rounded(6).border_1().border_color(th.input).bg(th.background).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(child);
    return v_flex().size_full()
      .child(h_flex().h(36).flex_none().px(10).gap(8).items_center().border_b(1).border_color(th.border)
        .when(this.files.length > 0, (el) => el.child(checkbox("inc-all", all, th, (cx) => { this.excluded = this.excluded.size ? new Set() : new Set(this.files.map((f) => f.path)); cx.notify(); })))
        .child(div().text_size(12).text_color(th.muted).child(t("changedFiles", { count: this.files.length }))))
      .child(v_flex().id("dlg-files").flex_1().min_h(0).py(4).overflow_y_scrollbar().children(this.files.map((f) => this.fileRow(f, th, { selectable: true })))
        .when(!this.files.length, (el) => el.child(div().p(10).text_size(12).text_color(th.dim).child(t("noChanges")))))
      .child(v_flex().flex_none().p(10).gap(6).border_t(1).border_color(th.border)
        .child(div().text_size(11).font_semibold().text_color(th.dim).child(t("commitSection").toUpperCase()))
        .child(field(Input.new(this.summary).h(30).text_size(12).text_color(th.foreground)))
        .child(field(Textarea.new(this.body).py(6).text_size(12).text_color(th.foreground)))
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(th.dim).child(this.files.length ? t("includedCount", { included: picked, total: this.files.length }) : ""))
          .when(this.ahead.count > 0, (el) => el.child(div().id("dlg-push").h(30).px(12).flex().items_center().gap(5).rounded(6).border_1().border_color(th.input).cursor_pointer()
            .text_size(12).hover((s) => s.bg(th.hover)).on_click((_e, cx) => this.doPush(cx)).child(icon("arrow-up", 13)).child(t("pushCount", { count: this.ahead.count }))))
          .child(div().id("dlg-commit").h(30).px(14).flex().items_center().rounded(6).bg(ok ? th.solid : th.raised).text_color(ok ? th.solid_foreground : th.dim).text_size(12)
            .when(ok, (e) => e.cursor_pointer()).on_click((_e, cx) => this.doCommit(cx)).child(this.busy ? t("committing") : t("commit")))));
  }

  historyList(th) {
    if (this.commit) return v_flex().size_full()
      .child(h_flex().h(36).flex_none().px(8).gap(6).items_center().border_b(1).border_color(th.border)
        .child(div().id("back").size(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(th.dim).hover((s) => s.bg(th.hover))
          .on_click((_e, cx) => { this.commit = null; this.commitFiles = []; this.showFile(null); cx.notify(); }).child(icon("chevron-left", 14)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(th.muted).child(`${this.commit.short} ${this.commit.subject}`)))
      .child(v_flex().id("dlg-commit-files").flex_1().min_h(0).py(4).overflow_y_scrollbar().children(this.commitFiles.map((f) => this.fileRow(f, th, { selectable: false })))
        .when(!this.commitFiles.length, (el) => el.child(div().p(10).text_size(12).text_color(th.dim).child(t("noFileChanges")))));
    return v_flex().id("dlg-commits").size_full().py(4).overflow_y_scrollbar()
      .children(this.commits.map((c) => v_flex().id(`c-${c.hash}`).mx(4).px(8).py(6).gap(2).rounded(4).cursor_pointer().hover((s) => s.bg(th.hover))
        .on_click((_e, cx) => this.pickCommit(c, cx))
        .child(div().truncate().text_color(th.foreground).child(c.subject))
        .child(h_flex().gap(6).text_size(11).text_color(th.dim).child(div().font_family("JetBrains Mono").child(c.short)).child(div().truncate().child(`${c.author} · ${c.when}`)))))
      .when(!this.commits.length, (el) => el.child(div().p(10).text_size(12).text_color(th.dim).child(t("noCommits"))));
  }

  render() {
    const th = theme();
    shared("2code.locale"); shared("2code.review");
    const queued = this.root ? reviewList(this.root).length : 0;
    const seg = (id, label, on, click, glyph) => h_flex().id(id).h(26).px(9).gap(5).items_center().rounded(5).cursor_pointer().text_size(12)
      .bg(on ? th.background : th.raised).text_color(on ? th.foreground : th.dim).when(on, (e) => e.shadow_sm())
      .on_click(click).when(Boolean(glyph), (e) => e.child(icon(glyph, 13))).child(label);
    const f = this.file;
    return v_flex().id("diff-dialog").size_full().bg(th.popover).text_color(th.foreground).text_size(13)
      .track_focus(this.handle).on_modifiers_changed((e) => { this.shift = Boolean(e.modifiers?.shift); })
      .child(h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(th.border)
        .child(icon("git-branch", 14).text_color(th.muted)).child(div().font_semibold().child(this.branch ?? ""))
        .child(h_flex().ml(8).p(3).gap(2).rounded(7).bg(th.raised)
          .child(seg("tab-changes", t("changes"), this.tab === "changes", (_e, cx) => this.setTab("changes", cx), "git-compare"))
          .child(seg("tab-history", t("history"), this.tab === "history", (_e, cx) => this.setTab("history", cx), "clock")))
        .child(div().flex_1())
        .when(queued > 0, (el) => el.child(h_flex().id("review").h(28).px(10).gap(6).items_center().rounded(6).border_1().border_color(th.input).cursor_pointer().text_size(12)
          .hover((s) => s.bg(th.hover))
          .on_click(() => openOverlay({ mod: "2code", kind: "dialog", width: 620, height: 0.7, props: { part: "review", root: this.root } }))
          .child(icon("message", 13)).child(t("reviewCount", { count: queued }))))
        .child(h_flex().p(3).gap(2).rounded(7).bg(th.raised)
          .child(seg("v-unified", t("unified"), this.view === "unified", (_e, cx) => { this.setView("unified"); cx.notify(); }, "rows"))
          .child(seg("v-split", t("split"), this.view === "split", (_e, cx) => { this.setView("split"); cx.notify(); }, "columns")))
        .child(div().id("close").size(26).flex().items_center().justify_center().rounded(6).cursor_pointer().text_color(th.dim).hover((s) => s.bg(th.hover))
          .on_click(() => closeOverlay(props().overlay)).child(icon("x", 14))))
      .child(h_flex().flex_1().min_h(0)
        .child(v_flex().w(360).flex_none().h_full().border_r(1).border_color(th.border)
          .child(this.tab === "changes" ? this.changesList(th) : this.historyList(th)))
        .child(v_flex().flex_1().min_w(0).h_full()
          .when(Boolean(f), (el) => el.child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(th.border)
            .child(badge(f.status, th)).child(div().flex_1().min_w(0).truncate().text_size(12.5).child(f.from ? `${f.from} → ${f.path}` : f.path))
            .child(div().text_size(11).text_color(th.ansi2).child(`+${f.add}`)).child(div().text_size(11).text_color(th.ansi1).child(`-${f.del}`))))
          .child(this.diffBody(th))))
      .when(Boolean(this.error), (el) => el.child(div().px(14).py(8).border_t(1).border_color(th.border).text_size(12).text_color(th.ansi1).child(this.error)));
  }
}
