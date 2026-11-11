// The 2code top bar: the side-panel switch (Files / Git with +/- stats), the
// project (click: open its folder) and branch (click: switch branch) in the
// middle, then the pull request, "Open in…" and the project's settings.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, layout, readTextFile, shared, openOverlay, exec, window, settings } from "herdr";
import { savedProjects, projectName } from "../lib/projects.js";
import { t } from "../lib/i18n.js";
import { git, repoOf, here, READ } from "../lib/git.js";
import { reveal } from "../lib/os.js";
import { icon, stop, find } from "../lib/ui.js";

const PR_EVERY = 60_000;

export class Topbar {
  init(_props, cx) {
    this.stats = { add: 0, del: 0 };
    this.repo = null;
    this.prs = {}; // "root:branch" -> { pr, at }
    this.refresh(cx);
    cx.timer.every(3000, (cx) => this.refresh(cx));
  }

  // What the bar describes: the focused folder on its machine.
  static key() {
    const { cwd, on } = here();
    return `${on ?? ""}:${cwd ?? ""}`;
  }

  refresh(cx) {
    const { cwd, on, branch } = here();
    if (this.busy || !cwd) return;
    const key = Topbar.key();
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const repo = await repoOf(cwd, on);
        let add = 0, del = 0;
        if (repo) {
          const head = await git(repo.top, ["rev-parse", "--verify", "HEAD"], on);
          const num = await git(repo.top, [...READ, "diff", ...(head.ok ? ["HEAD"] : ["--cached"]), "--numstat"], on);
          for (const line of num.out.split("\n")) {
            const [a, d] = line.split("\t");
            add += Number(a) || 0; del += Number(d) || 0;
          }
          const fresh = await git(repo.top, [...READ, "ls-files", "--others", "--exclude-standard"], on);
          for (const path of fresh.out.split("\n").filter(Boolean).slice(0, 50)) {
            const text = await readTextFile(`${repo.top}/${path}`, { on }).catch(() => null);
            if (text && !text.includes("\0")) add += text.split("\n").length - Number(text.endsWith("\n"));
          }
          await this.pullRequest(repo.top, branch, on);
        }
        this.repo = repo; this.stats = { add, del }; this.key = key;
      } catch {}
      finally { this.busy = false; cx.notify(); }
    });
  }

  // The branch's pull request through `gh`, at most once a minute per branch.
  async pullRequest(root, branch, on) {
    if (!branch) return;
    const id = `${on ?? ""}:${root}:${branch}`, seen = this.prs[id];
    if (seen && Date.now() - seen.at < PR_EVERY) return;
    this.prs[id] = { pr: seen?.pr ?? null, at: Date.now() };
    const r = await exec("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", "1", "--json", "number,state,isDraft,url"], { cwd: root, on, timeout: 20_000 }).catch(() => null);
    if (r?.code !== 0) return;
    try { this.prs[id].pr = JSON.parse(r.stdout)[0] ?? null; } catch {}
  }

  mode(id, th, child) {
    const panel = find(layout(), "panel");
    const active = panel && !panel.hidden && panel.active === id;
    return h_flex().id(`mode-${id}`).h(26).px(8).gap(5).items_center().rounded(6).cursor_pointer()
      .bg(active ? th.background : th.raised).text_color(active ? th.foreground : th.dim)
      .when(active, (el) => el.shadow_sm())
      .hover((s) => s.text_color(th.foreground)).on_mouse_down("left", stop)
      .on_click(() => {
        if (active) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel", child: id }); run("layout.show", { id: "panel" }); }
      })
      .child(child);
  }

  prChip(pr, th) {
    const state = pr.isDraft && pr.state === "OPEN" ? "draft" : pr.state.toLowerCase();
    const color = state === "open" ? th.ansi2 : state === "merged" ? th.ansi5 : state === "closed" ? th.ansi1 : th.dim;
    return h_flex().id("pr").h(24).px(8).gap(5).items_center().rounded(6).border_1().border_color(color + "55").text_size(11.5).text_color(color).cursor_pointer()
      .hover((s) => s.bg(th.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => cx.open_url(pr.url))
      .child(icon("git-pull-request", 13)).child(`#${pr.number} ${t(`pr_${state}`)}`);
  }

  render(cx) {
    const th = theme();
    shared("2code.locale");
    const { space, branch, on } = here();
    const sidebar = find(layout(), "sidebar");
    // Another space or folder than the last refresh: refresh now, and show what
    // Herdr knows until it lands rather than the previous project's numbers.
    const current = this.key === Topbar.key();
    if (!current) this.refresh(cx);
    const repo = current ? this.repo : null;
    const saved = repo ? savedProjects().find((p) => p.path === repo.main && (p.machine ?? null) === (on ?? null)) : null;
    const name = repo ? projectName(saved ?? { path: repo.main }) : space?.name ?? "";
    const stats = current ? this.stats : { add: 0, del: 0 };
    const pr = repo && branch ? this.prs[`${on ?? ""}:${repo.top}:${branch}`]?.pr : null;
    // macOS draws its window buttons at the layout's traffic_lights over this
    // bar when the sidebar is hidden or narrower than they are (as Herdr's own
    // tab bar does). Lights are in window px; the layout's sizes scale with zoom.
    const w = window(), root = layout();
    const sidebarPx = sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0;
    const narrow = !sidebar?.hidden && sidebarPx < 160;
    const lightsPad = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(12, (root.traffic_lights[0] + 64) / (settings().zoom ?? 1) - sidebarPx)
      : 12;
    const ghost = (id, glyph, tip, click) => div().id(id).size(28).flex().items_center().justify_center().rounded(6)
      .bg(th.raised).text_color(th.muted).hover((s) => s.text_color(th.foreground)).on_mouse_down("left", stop).tooltip(tip)
      .on_click(click).child(icon(glyph, 15));
    return h_flex().size_full().px(12).pl(lightsPad).gap(8).items_center().bg(th.background).border_b(1).border_color(th.border).text_size(13)
      // Hidden or folded to a rail: the way back is here.
      .when(Boolean(sidebar?.hidden) || narrow, (el) => el.child(div().id("sidebar-show").size(26).flex().items_center().justify_center().rounded(6)
        .text_color(th.dim).hover((s) => s.bg(th.hover)).on_mouse_down("left", stop)
        .on_click(() => (sidebar?.hidden ? run("layout.show", { id: "sidebar" }) : run("layout.resize", { id: "sidebar", px: 250 })))
        .child(icon("sidebar", 15))))
      .child(h_flex().p(3).gap(2).rounded(8).bg(th.raised)
        .child(this.mode("files", th, icon("folder", 14)))
        .child(this.mode("changes", th, h_flex().gap(5).items_center()
          .child(icon("git-branch", 14))
          .child(div().text_size(11.5).text_color(th.ansi2).child(`+${stats.add}`))
          .child(div().text_size(11.5).text_color(th.ansi1).child(`-${stats.del}`)))))
      .child(h_flex().flex_1().min_w(0).justify_center().gap(8).items_center()
        .child(div().id("project-name").font_semibold().text_size(14).text_color(th.foreground).truncate().rounded(5).px(4)
          .when(Boolean(repo && !on), (el) => el.cursor_pointer().hover((s) => s.bg(th.hover)).tooltip(repo.top).on_mouse_down("left", stop).on_click(() => reveal(repo.top)))
          .child(name))
        .when(Boolean(branch), (el) => el.child(h_flex().id("branch").gap(4).px(4).items_center().rounded(5).text_color(th.dim)
          .when(Boolean(repo), (e) => e.cursor_pointer().hover((s) => s.bg(th.hover).text_color(th.foreground)).on_mouse_down("left", stop)
            .on_click(() => openOverlay({ mod: "2code", kind: "dialog", width: 520, height: 0.7, props: { part: "branches", root: repo.top, on } })))
          .child(icon("git-branch", 13)).child(div().truncate().child(branch)))))
      .when(Boolean(pr), (el) => el.child(this.prChip(pr, th)))
      .when(Boolean(repo && !on), (el) => el.child(ghost("open-in", "external-link", t("openIn"),
        () => openOverlay({ mod: "2code", kind: "popup", width: 220, height: 360, props: { part: "openIn", path: repo.top } }))))
      // As in 2code, the gear is the project's settings (its 2code.json).
      .child(ghost("project-settings", "settings", t("projectSettings"), () => {
        if (!repo) return run("app.settings");
        openOverlay({ mod: "2code", kind: "dialog", width: 640, height: 0.8, props: { part: "projectSettings", path: repo.main, machine: on, name } });
      }));
  }
}
