// Switch branch (click the branch in the top bar), like 2code's dialog: a
// searchable list marking the current branch, the trunk and branches another
// worktree has checked out, with ahead/behind counts.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { git } from "../lib/git.js";
import { icon } from "../lib/ui.js";

export class Branches {
  init(p, cx) {
    this.p = p;
    this.list = null; this.at = 0; this.error = null;
    this.input = InputState.new({ placeholder: t("searchBranches") });
    this.input.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.pick(this.shown()[this.at], cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
    cx.spawn(async (cx) => {
      const { root, on } = p;
      const current = (await git(root, ["branch", "--show-current"], on)).out;
      const head = await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], on);
      const trunk = head.ok ? head.out.replace(/^origin\//, "") : null;
      const wt = await git(root, ["worktree", "list", "--porcelain"], on);
      const used = new Map();
      for (const block of wt.out.split(/\n\n+/)) {
        const path = /^worktree (.*)$/m.exec(block)?.[1], branch = /^branch refs\/heads\/(.*)$/m.exec(block)?.[1];
        if (path && branch && path !== root) used.set(branch, path);
      }
      const locals = await git(root, ["for-each-ref", "refs/heads", "--sort=-committerdate", "--format=%(refname:short)%09%(upstream:track,nobracket)"], on);
      const list = locals.out.split("\n").filter(Boolean).map((l) => {
        const [name, track = ""] = l.split("\t");
        return { name, ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0), current: name === current, trunk: name === trunk, used: used.get(name) ?? null };
      });
      // Full ref names: the short form prints origin/HEAD as "origin".
      const remotes = await git(root, ["for-each-ref", "refs/remotes", "--sort=-committerdate", "--format=%(refname)"], on);
      for (const ref of remotes.out.split("\n").filter(Boolean)) {
        if (ref.endsWith("/HEAD")) continue;
        const name = ref.replace(/^refs\/remotes\//, ""), short = name.replace(/^[^/]+\//, "");
        if (list.some((b) => b.name === short)) continue;
        list.push({ name: short, remote: name, ahead: 0, behind: 0, current: false, trunk: short === trunk, used: null });
      }
      list.sort((a, b) => b.current - a.current || b.trunk - a.trunk);
      this.list = list;
      cx.notify();
    });
  }

  shown() {
    const q = this.input.value().trim().toLowerCase();
    return (this.list ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
  }

  pick(b, cx) {
    if (!b || b.current || b.used || this.busy) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      const r = await git(this.p.root, b.remote ? ["switch", "--track", b.remote] : ["switch", b.name], this.p.on, 120_000);
      this.busy = false;
      if (r.ok) closeOverlay(props().overlay);
      else { this.error = r.err; cx.notify(); }
    });
  }

  key(e, cx) {
    const n = this.shown().length;
    if (e.key === "escape") return closeOverlay(props().overlay);
    if ((e.key === "down" || e.key === "up") && n) { this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n; cx.stop_propagation(); cx.notify(); }
  }

  render() {
    const th = theme();
    const rows = this.shown();
    const tag = (text, color) => div().px(5).py(0.5).rounded(4).border_1().border_color(color + "55").text_size(10.5).text_color(color).child(text);
    return v_flex().id("branches").size_full().bg(th.popover).text_color(th.foreground).text_size(13)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().px(14).pt(14).pb(8).gap(8).items_center()
        .child(icon("git-branch", 15).text_color(th.muted)).child(div().text_size(15).font_semibold().child(t("switchBranch"))))
      .child(h_flex().mx(14).px(10).gap(6).items_center().rounded(6).border_1().border_color(th.accent).bg(th.background)
        .child(icon("search", 13).text_color(th.dim)).child(div().flex_1().child(Input.new(this.input).h(32).text_size(13).text_color(th.foreground))))
      .child(v_flex().id("branch-list").flex_1().min_h(0).p(8).gap(1).overflow_y_scrollbar()
        .children(rows.map((b, i) => h_flex().id(`b-${b.remote ?? b.name}`).h(32).px(8).gap(8).items_center().rounded(5)
          .bg(i === this.at ? th.selected : th.popover).when(!b.current && !b.used, (el) => el.cursor_pointer().hover((s) => s.bg(th.hover)))
          .on_click((_e, cx) => this.pick(b, cx))
          .child(icon(b.current ? "check" : "git-branch", 13).text_color(b.current ? th.foreground : th.dim))
          .child(div().flex_1().min_w(0).truncate().text_color(b.used ? th.dim : th.foreground).child(b.remote ?? b.name))
          .when(b.current, (el) => el.child(tag(t("branchCurrent"), th.ansi2)))
          .when(b.trunk, (el) => el.child(tag(t("branchTrunk"), th.ansi4)))
          .when(Boolean(b.used), (el) => el.child(tag(t("branchUsed"), th.dim)))
          .when(b.ahead > 0, (el) => el.child(div().text_size(11).text_color(th.dim).child(`↑${b.ahead}`)))
          .when(b.behind > 0, (el) => el.child(div().text_size(11).text_color(th.dim).child(`↓${b.behind}`)))))
        .when(this.list === null, (el) => el.child(div().p(8).text_color(th.dim).child("…")))
        .when(this.list !== null && !rows.length, (el) => el.child(div().p(8).text_color(th.dim).child(t("noBranches")))))
      .when(Boolean(this.error), (el) => el.child(div().px(14).pb(10).text_size(12).text_color(th.ansi1).child(this.error)));
  }
}
