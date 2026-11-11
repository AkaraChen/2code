// The 2code sidebar: projects (git repos) with their profiles (worktrees) nested.
// A project is every space whose checkout belongs to the same repo; the space at
// the repo's main checkout is the default profile, the others are worktrees.
// Nothing is stored: projects come from Herdr's spaces and git.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, run, theme, pickFolder, openOverlay, shared, notify } from "herdr";
import { t, resolveLocale } from "../lib/i18n.js";
import { readProjectConfig, scriptArgv } from "../lib/config.js";
import { place, repoOf } from "../lib/git.js";
import { icon, stop, dot, worst } from "../lib/ui.js";

export class SidebarHeader {
  render() {
    const th = theme();
    return h_flex().size_full().px(16).items_center().justify_between().bg(th.chrome)
      .child(div().text_size(15).font_semibold().text_color(th.foreground).child("2Code"))
      .child(div().id("sidebar-toggle").size(24).flex().items_center().justify_center().rounded(6).text_color(th.dim)
        .hover((s) => s.bg(th.hover).text_color(th.foreground)).on_mouse_down("left", stop)
        .on_click(() => run("layout.toggle", { id: "sidebar" }))
        .child(icon("sidebar", 15)));
  }
}

export class Sidebar {
  init(_props, cx) {
    this.repo = {}; // space id -> { at, main, top, name }
    this.closed = JSON.parse(localStorage.getItem("closed") ?? "{}");
    this.hover = null;
    cx.spawn(async () => { await resolveLocale(); });
    this.refresh(cx);
    cx.timer.every(4000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const all = panes();
        for (const s of spaces()) {
          const at = place(s, all);
          if (!at || this.repo[s.id]?.at === at) continue;
          const r = await repoOf(at, s.machine);
          this.repo[s.id] = r ? { at, ...r } : { at, main: at, top: at, name: at.split("/").pop() || at };
        }
      } catch {}
      finally { this.busy = false; cx.notify(); }
    });
  }

  projects() {
    const groups = new Map();
    for (const s of spaces()) {
      const r = this.repo[s.id] ?? { main: s.folder || s.id, top: s.folder, name: s.name };
      const key = `${s.machine ?? ""}:${r.main}`;
      if (!groups.has(key)) groups.set(key, { key, name: r.name, main: r.main, machine: s.machine ?? null, spaces: [] });
      groups.get(key).spaces.push({ ...s, top: r.top, isDefault: r.top === r.main });
    }
    for (const g of groups.values()) g.spaces.sort((a, b) => b.isDefault - a.isDefault);
    return [...groups.values()];
  }

  toggle(key) {
    this.closed[key] = !this.closed[key];
    localStorage.setItem("closed", JSON.stringify(this.closed));
  }

  addProject() {
    pickFolder({ prompt: t("addProject") }).then((folder) => { if (folder) run("space.new", { folder }); });
  }

  // Herdr's own worktree dialog makes the checkout; 2code adds the project's
  // setup script as the new space's first tab.
  newProfile(p, cx) {
    cx.spawn(async () => {
      const config = await readProjectConfig(p.main, p.machine);
      if (config.error) notify({ title: "2code", body: t("configError", { error: config.error }), level: "warning" });
      const setup = config.setup_script.length ? { tab: t("setupTab"), argv: scriptArgv(config.setup_script) } : {};
      openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: p.spaces[0].id, folder: p.main, action: "new", ...setup } });
    });
  }

  deleteProfile(s, main) {
    openOverlay({ mod: "2code", kind: "dialog", width: 460, height: 300, props: { part: "teardown", space: s.id, top: s.top, main, name: s.branch ?? s.name, on: s.machine ?? null } });
  }

  projectRow(p, th) {
    const active = p.spaces.some((s) => s.active);
    const open = !this.closed[p.key];
    const status = worst(p.spaces.map((s) => s.status));
    const hovered = this.hover === p.key;
    return h_flex().id(`project-${p.key}`).h(32).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(active && !open ? th.selected : th.chrome).hover((s) => s.bg(th.hover))
      .on_hover((h, cx) => { this.hover = h ? p.key : (this.hover === p.key ? null : this.hover); cx.notify(); })
      .on_click(() => run("space.select", { id: (p.spaces.find((s) => s.active) ?? p.spaces[0]).id }))
      .child(div().size(20).flex_none().flex().items_center().justify_center().rounded(5).bg(th.raised)
        .text_size(11).font_semibold().text_color(th.muted).child((p.name[0] ?? "?").toUpperCase()))
      .child(div().flex_1().min_w(0).truncate().text_color(th.foreground).child(p.name))
      .when(!hovered && Boolean(dot(status, th)), (el) => el.child(dot(status, th)))
      .when(hovered, (el) => el.child(div().id(`profile-new-${p.key}`).size(20).flex().items_center().justify_center().rounded(5)
        .text_color(th.dim).hover((s) => s.bg(th.raised).text_color(th.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.newProfile(p, cx); })
        .child(icon("plus", 13))))
      .child(div().id(`project-caret-${p.key}`).size(18).flex().items_center().justify_center().text_color(th.dim)
        .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(p.key); cx.notify(); })
        .child(icon(open ? "chevron-down" : "chevron-right", 13)));
  }

  profileRow(s, p, th) {
    const label = s.branch ?? (s.isDefault ? t("defaultProfile") : s.name);
    const hovered = this.hover === s.id;
    return h_flex().id(`profile-${s.id}`).h(28).pl(36).pr(8).gap(7).items_center().rounded(6).cursor_pointer()
      .bg(s.active ? th.selected : th.chrome).hover((st) => st.bg(th.hover))
      .on_hover((h, cx) => { this.hover = h ? s.id : (this.hover === s.id ? null : this.hover); cx.notify(); })
      .on_click(() => run("space.select", { id: s.id }))
      .child(icon("git-branch", 13).text_color(s.active ? th.foreground : th.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(s.active ? th.foreground : th.muted).child(label))
      .when(!(hovered && !s.isDefault) && Boolean(dot(s.status, th)), (el) => el.child(dot(s.status, th)))
      .when(hovered && !s.isDefault, (el) => el.child(div().id(`profile-delete-${s.id}`).size(18).flex().items_center().justify_center().rounded(5)
        .text_color(th.dim).hover((st) => st.bg(th.raised).text_color(th.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.deleteProfile(s, p.main); })
        .child(icon("x", 12))));
  }

  render() {
    const th = theme();
    shared("2code.locale"); // re-render on language change
    const projects = this.projects();
    return v_flex().size_full().min_h(0).bg(th.chrome).text_size(13)
      .child(h_flex().h(30).px(16).items_center().justify_between()
        .child(div().text_size(12).text_color(th.dim).child(t("projects")))
        .child(div().id("project-new").size(22).flex().items_center().justify_center().rounded(5).text_color(th.dim)
          .hover((s) => s.bg(th.hover).text_color(th.foreground)).on_click(() => this.addProject())
          .child(icon("plus", 14))))
      .child(v_flex().id("project-list").flex_1().min_h(0).px(8).gap(1).overflow_y_scrollbar()
        .children(projects.flatMap((p) => [
          this.projectRow(p, th),
          ...(this.closed[p.key] ? [] : p.spaces.map((s) => this.profileRow(s, p, th))),
        ]))
        .when(!projects.length, (el) => el.child(div().p(8).text_color(th.dim).child(t("noProjects")))))
      .child(h_flex().id("settings").h(32).mx(8).mb(10).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .text_color(th.muted).hover((s) => s.bg(th.hover).text_color(th.foreground))
        .on_click(() => run("app.settings"))
        .child(icon("settings", 15)).child(t("settings")));
  }
}
