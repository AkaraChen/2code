// The 2code top bar: the side-panel switch (Files / Git with +/- stats), the
// project and branch in the middle, settings on the right.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { run, theme, layout, readTextFile, shared, openOverlay } from "herdr";
import { savedProjects, projectName } from "../lib/projects.js";
import { t } from "../lib/i18n.js";
import { git, repoOf, here, READ } from "../lib/git.js";
import { icon, stop, find } from "../lib/ui.js";

export class Topbar {
  init(_props, cx) {
    this.stats = { add: 0, del: 0 };
    this.repo = null;
    this.refresh(cx);
    cx.timer.every(3000, (cx) => this.refresh(cx));
  }

  // What the bar describes: the focused folder on its machine.
  static key() {
    const { cwd, on } = here();
    return `${on ?? ""}:${cwd ?? ""}`;
  }

  refresh(cx) {
    const { cwd, on } = here();
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
        }
        this.repo = repo; this.stats = { add, del }; this.key = key;
      } catch {}
      finally { this.busy = false; cx.notify(); }
    });
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

  render(cx) {
    const th = theme();
    shared("2code.locale");
    const { space, branch } = here();
    const sidebar = find(layout(), "sidebar");
    // Another space or folder than the last refresh: refresh now, and show what
    // Herdr knows until it lands rather than the previous project's numbers.
    const current = this.key === Topbar.key();
    if (!current) this.refresh(cx);
    const name = (current ? this.repo?.name : null) ?? space?.name ?? "";
    const stats = current ? this.stats : { add: 0, del: 0 };
    return h_flex().size_full().px(12).gap(8).items_center().bg(th.background).border_b(1).border_color(th.border).text_size(13)
      .when(Boolean(sidebar?.hidden), (el) => el.child(div().id("sidebar-show").size(26).flex().items_center().justify_center().rounded(6)
        .text_color(th.dim).hover((s) => s.bg(th.hover)).on_mouse_down("left", stop)
        .on_click(() => run("layout.show", { id: "sidebar" })).child(icon("sidebar", 15))))
      .child(h_flex().p(3).gap(2).rounded(8).bg(th.raised)
        .child(this.mode("files", th, icon("folder", 14)))
        .child(this.mode("changes", th, h_flex().gap(5).items_center()
          .child(icon("git-branch", 14))
          .child(div().text_size(11.5).text_color(th.ansi2).child(`+${stats.add}`))
          .child(div().text_size(11.5).text_color(th.ansi1).child(`-${stats.del}`)))))
      .child(h_flex().flex_1().min_w(0).justify_center().gap(8).items_center()
        .child(div().font_semibold().text_size(14).text_color(th.foreground).truncate().child(name))
        .when(Boolean(branch), (el) => el.child(h_flex().gap(4).items_center().text_color(th.dim)
          .child(icon("git-branch", 13)).child(div().truncate().child(branch)))))
      // As in 2code, the gear is the project's settings (its 2code.json).
      .child(div().id("project-settings").size(28).flex().items_center().justify_center().rounded(6)
        .bg(th.raised).text_color(th.muted).hover((s) => s.text_color(th.foreground)).on_mouse_down("left", stop)
        .on_click(() => {
          if (!current || !this.repo) return run("app.settings");
          openOverlay({ mod: "2code", kind: "dialog", width: 640, height: 0.8, props: { part: "projectSettings", path: this.repo.main, machine: here().on, name: projectName({ path: this.repo.main, ...(savedProjects().find((p) => p.path === this.repo.main) ?? {}) }) } });
        })
        .child(icon("settings", 15)));
  }
}
