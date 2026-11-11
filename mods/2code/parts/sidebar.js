// The 2code sidebar: projects with their profiles nested.
// - Projects are the saved list (lib/projects.js); any space opened on a repo
//   that isn't in it yet is added, so it stays after its terminals close.
// - Profiles are the repo's checkouts (`git worktree list`): the main checkout
//   first, then worktrees. Open ones show their space's status; picking a
//   closed one opens a space there.
import { div, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, run, theme, layout, window, pickFolder, openOverlay, shared, notify } from "herdr";
import { t, resolveLocale } from "../lib/i18n.js";
import { readProjectConfig, scriptArgv } from "../lib/config.js";
import { place, repoOf } from "../lib/git.js";
import { savedProjects, addProject, projectKey, projectName, checkouts } from "../lib/projects.js";
import { githubOwner, githubAvatar } from "../lib/os.js";
import { icon, stop, dot, worst, find } from "../lib/ui.js";

const RAIL = 160; // narrower than this, the sidebar draws only project tiles

// The brand: Herdr's mark and name, and on hover a slot-machine flip to
// 2code's: the shown one rolls out first, the other rolls in a beat later;
// leaving rolls them back. Native transitions, no timers. (`spring` on `top`
// didn't move here; `transition` does.)
export class SidebarHeader {
  init() {
    this.hover = false;
  }

  layer(id, logo, text, shown, away, th) {
    // The policy set with the new target is the one that runs: arriving
    // layers wait a beat and ease out, leaving ones ease in right away.
    const move = shown ? { duration: 380, delay: 70, easing: "ease-out" } : { duration: 260, easing: "ease-in" };
    const fade = shown ? { duration: 260, delay: 70, easing: "ease-out" } : { duration: 180, easing: "ease-in" };
    return h_flex().id(id).absolute().left(0).top(shown ? 0 : away).h(24).gap(8).items_center()
      .opacity(shown ? 1 : 0)
      .transition("top", move)
      .transition("opacity", fade)
      .child(image(logo).size(20).flex_none().rounded(5))
      .child(div().text_size(15).font_semibold().text_color(th.foreground).child(text));
  }

  render() {
    const th = theme(), w = window();
    const narrow = (find(layout(), "sidebar")?.size?.px ?? 250) < RAIL;
    // macOS draws its window buttons at the layout's traffic_lights spot
    // (vertically centered on this 52px row); on the rail they fill it.
    const lights = w?.platform === "macos" && w?.titlebar === "none" && !w?.fullscreen;
    if (lights && narrow) return div().size_full().bg(th.chrome);
    return h_flex().id("brand-row").size_full().px(narrow ? 0 : 16).items_center().bg(th.chrome)
      .when(lights && !narrow, (el) => el.pl(76))
      .on_hover((h, cx) => { if (this.hover !== h) { this.hover = h; cx.notify(); } })
      .when(narrow, (el) => el.justify_center())
      .when(!narrow, (el) => el.justify_between().child(div().relative().w(110).h(24).overflow_hidden()
        .child(this.layer("brand-herdr", "frame/welcome/herdr.png", "Herdr", !this.hover, -26, th))
        .child(this.layer("brand-2code", "mods/2code/icons/2code.png", "2Code", this.hover, 26, th))))
      .child(div().id("sidebar-toggle").size(24).flex().items_center().justify_center().rounded(6).text_color(th.dim)
        .hover((s) => s.bg(th.hover).text_color(th.foreground)).on_mouse_down("left", stop)
        .on_click(() => run("layout.toggle", { id: "sidebar" }))
        .child(icon("sidebar", 15)));
  }
}

export class Sidebar {
  static COMMANDS = ["focusSidebar"];

  command(name) {
    if (name === "focusSidebar") this.handle.focus();
  }

  init(_props, cx) {
    // Arrow keys move through the list while it has the keyboard (a click on
    // the sidebar, or cmd-shift-e / ctrl-shift-j).
    this.handle = cx.focus_handle();
    this.cursor = null;
    this.repo = {};       // space id -> { at, main, top, name }
    this.checkouts = {};  // project key -> [{ path, branch, main }]
    this.avatars = {};    // project key -> image path | null
    this.closed = JSON.parse(localStorage.getItem("closed") ?? "{}");
    this.hover = null;
    this.width = 250;
    cx.spawn(async () => { await resolveLocale(); });
    this.refresh(cx);
    cx.timer.every(4000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // Which repo every open space is in; new repos join the project list.
        const all = panes();
        for (const s of spaces()) {
          const at = place(s, all);
          if (!at) continue;
          if (this.repo[s.id]?.at !== at) {
            const r = await repoOf(at, s.machine);
            this.repo[s.id] = r ? { at, ...r } : { at, main: at, top: at, name: at.split("/").pop() || at };
          }
          addProject(this.repo[s.id].main, s.machine ?? null);
        }
        // Every project's checkouts, and its GitHub avatar once.
        for (const p of savedProjects()) {
          const key = projectKey(p);
          this.checkouts[key] = await checkouts(p.path, p.machine);
          if (!(key in this.avatars)) {
            this.avatars[key] = null;
            const owner = await githubOwner(p.path, p.machine).catch(() => null);
            this.avatars[key] = await githubAvatar(owner);
          }
        }
      } catch {}
      finally { this.busy = false; cx.notify(); }
    });
  }

  // Projects in saved order, each with its profiles: a checkout and the open
  // space showing it (if any).
  projects() {
    const open = spaces().map((s) => ({ s, r: this.repo[s.id] }));
    return savedProjects().map((p) => {
      const key = projectKey(p), on = p.machine ?? null;
      const mine = open.filter(({ s, r }) => (s.machine ?? null) === on && r && r.main === p.path);
      const list = this.checkouts[key] ?? [{ path: p.path, branch: null, main: true }];
      const profiles = list.map((c) => ({ ...c, space: mine.find(({ r }) => r.top === c.path)?.s ?? null }));
      // Spaces in this repo whose checkout git didn't list (yet): show them too.
      for (const { s, r } of mine) if (!profiles.some((x) => x.space?.id === s.id)) profiles.push({ path: r.top, branch: s.branch, main: r.top === p.path, space: s });
      for (const x of profiles) if (!x.branch && x.space?.branch) x.branch = x.space.branch;
      return { path: p.path, machine: on, on, key, name: projectName(p), profiles, avatar: this.avatars[key] ?? null };
    });
  }

  toggle(key) {
    this.closed[key] = !this.closed[key];
    localStorage.setItem("closed", JSON.stringify(this.closed));
  }

  addProject() {
    pickFolder({ prompt: t("addProject") }).then(async (folder) => {
      if (!folder) return;
      const r = await repoOf(folder, null).catch(() => null);
      addProject(r?.main ?? folder, null);
      run("space.new", { folder: r?.top ?? folder });
    });
  }

  // Opens a profile: its space if it has one, else a new space on its checkout.
  openProfile(p, x) {
    if (x.space) run("space.select", { id: x.space.id });
    else run("space.new", { folder: x.path, machine: p.on ?? "" });
  }

  openProject(p) {
    const shown = p.profiles.find((x) => x.space?.active) ?? p.profiles.find((x) => x.space) ?? p.profiles[0];
    if (shown) this.openProfile(p, shown);
  }

  menu(kind, p, x) {
    const target = { path: p.path, machine: p.on, name: p.name, ...(x ? { top: x.path, branch: x.branch, main: x.main, space: x.space?.id ?? null } : {}) };
    openOverlay({ mod: "2code", kind: "popup", width: 230, height: kind === "project" ? 196 : 124, props: { part: "menu", kind, target } });
  }

  avatar(p, th, size = 20) {
    if (p.avatar) return image(p.avatar).size(size).flex_none().rounded(5);
    return div().size(size).flex_none().flex().items_center().justify_center().rounded(5).bg(th.raised)
      .text_size(size * 0.55).font_semibold().text_color(th.muted).child((p.name[0] ?? "?").toUpperCase());
  }

  projectRow(p, th) {
    const active = p.profiles.some((x) => x.space?.active);
    const open = !this.closed[p.key];
    const status = worst(p.profiles.map((x) => x.space?.status));
    const hovered = this.hover === p.key;
    return h_flex().id(`project-${p.key}`).h(32).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(active && !open ? th.selected : th.chrome).hover((s) => s.bg(th.hover))
      .border_1().border_color(this.ring(p.key) ? th.accent : th.chrome + "00")
      .on_hover((h, cx) => { this.hover = h ? p.key : (this.hover === p.key ? null : this.hover); cx.notify(); })
      .on_click(() => { this.cursor = p.key; this.openProject(p); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("project", p); })
      .child(this.avatar(p, th))
      .child(div().flex_1().min_w(0).truncate().text_color(th.foreground).child(p.name))
      // The project's dot sums up its worktrees, so it shows only while they're folded away.
      .when(!open && !hovered && Boolean(dot(status, th)), (el) => el.child(dot(status, th)))
      .when(hovered, (el) => el.child(div().id(`profile-new-${p.key}`).size(20).flex().items_center().justify_center().rounded(5)
        .text_color(th.dim).hover((s) => s.bg(th.raised).text_color(th.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); newProfile(p, cx); })
        .child(icon("plus", 13))))
      .child(div().id(`project-caret-${p.key}`).size(18).flex().items_center().justify_center().text_color(th.dim)
        .on_click((_e, cx) => { cx.stop_propagation(); this.toggle(p.key); cx.notify(); })
        .child(icon(open ? "chevron-down" : "chevron-right", 13)));
  }

  profileRow(p, x, th) {
    const label = x.branch ?? (x.main ? t("defaultProfile") : x.path.split("/").pop());
    const id = `${p.key}:${x.path}`, hovered = this.hover === id, active = Boolean(x.space?.active);
    const color = active ? th.foreground : x.space ? th.muted : th.dim;
    return h_flex().id(`profile-${id}`).h(28).pl(36).pr(8).gap(7).items_center().rounded(6).cursor_pointer()
      .bg(active ? th.selected : th.chrome).hover((st) => st.bg(th.hover))
      .border_1().border_color(this.ring(id) ? th.accent : th.chrome + "00")
      .on_hover((h, cx) => { this.hover = h ? id : (this.hover === id ? null : this.hover); cx.notify(); })
      .on_click(() => { this.cursor = id; this.openProfile(p, x); })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("profile", p, x); })
      .child(icon("git-branch", 13).text_color(color))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(color).child(label))
      // An 18px slot like the project's caret, so dots line up under it;
      // hovering a worktree swaps the dot for its delete button.
      .child(hovered && !x.main
        ? div().id(`profile-delete-${id}`).size(18).flex_none().flex().items_center().justify_center().rounded(5)
          .text_color(th.dim).hover((st) => st.bg(th.raised).text_color(th.foreground))
          .on_click((_e, cx) => { cx.stop_propagation(); deleteProfile(p, x); })
          .child(icon("x", 12))
        : div().w(18).flex_none().flex().items_center().justify_center()
          .when(Boolean(dot(x.space?.status, th)), (el) => el.child(dot(x.space.status, th))));
  }

  ring(id) {
    return this.cursor === id && this.handle.is_focused();
  }

  // The rows the arrow keys walk, in screen order.
  navRows(projects) {
    return projects.flatMap((p) => [
      { id: p.key, p },
      ...(this.closed[p.key] ? [] : p.profiles.map((x) => ({ id: `${p.key}:${x.path}`, p, x }))),
    ]);
  }

  key(e, projects, cx) {
    const rows = this.navRows(projects);
    if (!rows.length) return;
    let i = rows.findIndex((r) => r.id === this.cursor);
    const row = rows[i];
    const k = e.key;
    if (k === "down") i = i < 0 ? 0 : Math.min(i + 1, rows.length - 1);
    else if (k === "up") i = i < 0 ? 0 : Math.max(i - 1, 0);
    else if (k === "right" && row && !row.x) {
      if (this.closed[row.p.key]) this.toggle(row.p.key);
      else if (rows[i + 1]?.x) i += 1;
    } else if (k === "left" && row) {
      if (row.x) i = rows.findIndex((r) => r.id === row.p.key);
      else if (!this.closed[row.p.key]) this.toggle(row.p.key);
    } else if ((k === "enter" || k === "space") && row) {
      if (row.x) this.openProfile(row.p, row.x); else this.openProject(row.p);
    } else if (k === "escape") {
      const pane = focused()?.pane;
      if (pane) run("pane.focus", { pane });
    } else return;
    this.cursor = rows[Math.max(0, i)]?.id ?? null;
    cx.stop_propagation();
    cx.notify();
  }

  rail(projects, th) {
    return v_flex().id("project-rail").flex_1().min_h(0).py(2).gap(6).items_center().overflow_y_scrollbar()
      .children(projects.map((p) => {
        const active = p.profiles.some((x) => x.space?.active), status = worst(p.profiles.map((x) => x.space?.status));
        return div().id(`rail-${p.key}`).relative().p(4).rounded(7).cursor_pointer().bg(active ? th.selected : th.chrome).hover((s) => s.bg(th.hover))
          .on_click(() => this.openProject(p))
          .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.menu("project", p); })
          .child(this.avatar(p, th, 24))
          .when(Boolean(dot(status, th)), (el) => el.child(div().absolute().top(1).right(1).child(dot(status, th))));
      }));
  }

  render() {
    const th = theme();
    shared("2code.locale"); shared("2code.projects");
    const projects = this.projects();
    const narrow = this.width < RAIL;
    if (this.handle.is_focused() && !this.cursor) {
      const p = projects.find((q) => q.profiles.some((x) => x.space?.active));
      const x = p?.profiles.find((y) => y.space?.active);
      this.cursor = p ? (x && !this.closed[p.key] ? `${p.key}:${x.path}` : p.key) : projects[0]?.key ?? null;
    }
    return v_flex().id("sidebar-root").size_full().min_h(0).bg(th.chrome).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, projects, cx))
      .on_mouse_down("left", (_e, cx) => { this.handle.focus(); cx.notify(); })
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) >= 1) { this.width = size.width; cx.notify(); } })
      .child(h_flex().h(30).px(narrow ? 0 : 16).items_center().when(narrow, (el) => el.justify_center())
        .when(!narrow, (el) => el.justify_between().child(div().text_size(12).text_color(th.dim).child(t("projects"))))
        .child(div().id("project-new").size(22).flex().items_center().justify_center().rounded(5).text_color(th.dim)
          .hover((s) => s.bg(th.hover).text_color(th.foreground)).on_click(() => this.addProject())
          .child(icon("plus", 14))))
      .child(narrow ? this.rail(projects, th) : v_flex().id("project-list").flex_1().min_h(0).px(8).gap(1).overflow_y_scrollbar()
        .children(projects.flatMap((p) => [
          this.projectRow(p, th),
          ...(this.closed[p.key] ? [] : p.profiles.map((x) => this.profileRow(p, x, th))),
        ]))
        .when(!projects.length, (el) => el.child(div().p(8).text_color(th.dim).child(t("noProjects")))))
      .child(h_flex().id("settings").h(32).mx(8).mb(10).px(narrow ? 0 : 8).gap(8).items_center().rounded(6).cursor_pointer()
        .when(narrow, (el) => el.justify_center())
        .text_color(th.muted).hover((s) => s.bg(th.hover).text_color(th.foreground))
        .on_click(() => run("app.settings"))
        .child(icon("settings", 15)).when(!narrow, (el) => el.child(t("settings"))));
  }
}

// Herdr's own New worktree dialog makes the checkout; 2code adds the project's
// setup script as the new space's first tab.
export async function openNewProfile(p) {
  const on = p.on ?? p.machine ?? null;
  const config = await readProjectConfig(p.path, on);
  if (config.error) notify({ title: "2code", body: t("configError", { error: config.error }), level: "warning" });
  const setup = config.setup_script.length ? { tab: t("setupTab"), argv: scriptArgv(config.setup_script) } : {};
  openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { folder: p.path, machine: on, action: "new", ...setup } });
}

export function newProfile(p, cx) {
  cx.spawn(async () => { await openNewProfile(p); });
}

export function deleteProfile(p, x) {
  openOverlay({ mod: "2code", kind: "dialog", width: 480, height: 340, props: { part: "deleteProfile", main: p.path, top: x.path, branch: x.branch ?? null, space: x.space?.id ?? null, on: p.on ?? p.machine ?? null } });
}
