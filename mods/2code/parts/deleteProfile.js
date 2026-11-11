// Deleting a profile, as 2code did: show what would be lost (uncommitted files,
// commits on no remote), run the project's teardown script in the worktree,
// close its space and remove the checkout. The branch stays.
// Herdr's own Remove worktree needs an open space (without one it would close
// the focused space), and profiles can be closed here, so this does it itself.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, exec, run, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { readProjectConfig } from "../lib/config.js";
import { git, READ } from "../lib/git.js";
import { button } from "../lib/ui.js";

export class DeleteProfile {
  init(p, cx) {
    this.p = p;
    this.script = null;  // null: reading
    this.check = null;   // { dirty, unpushed } once read
    this.state = "idle"; // idle | teardown | removing
    this.error = null;
    cx.spawn(async (cx) => {
      const config = await readProjectConfig(p.main, p.on);
      this.script = config.teardown_script;
      const status = await git(p.top, [...READ, "status", "--porcelain"], p.on);
      const unpushed = p.branch ? await git(p.top, ["rev-list", "--count", "HEAD", "--not", "--remotes"], p.on) : { ok: false };
      this.check = {
        dirty: status.ok ? status.out.split("\n").filter(Boolean).length : 0,
        unpushed: unpushed.ok ? Number(unpushed.out) || 0 : 0,
      };
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  run(withTeardown, cx) {
    if (this.state !== "idle") return;
    this.error = null;
    cx.spawn(async (cx) => {
      const { top, main, on, space } = this.p;
      try {
        if (withTeardown) {
          this.state = "teardown"; cx.notify();
          for (const line of this.script) {
            const r = await exec("sh", ["-c", line], { cwd: top, on, timeout: 600_000 });
            if (r.code !== 0) throw new Error(t("teardownFailed", { error: `${line}: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}` }));
          }
        }
        this.state = "removing"; cx.notify();
        // Terminals first: a shell sitting in the folder keeps it busy on Windows.
        if (space) run("space.close", { id: space, confirmed: true });
        const force = (this.check?.dirty ?? 0) > 0;
        const r = await git(main, ["worktree", "remove", ...(force ? ["--force"] : []), top], on, 600_000);
        if (!r.ok) throw new Error(t("removeFailed", { error: r.err }));
        this.close();
      } catch (e) {
        this.state = "idle"; this.error = String(e?.message ?? e);
        cx.notify();
      }
    });
  }

  render() {
    const th = theme();
    const script = this.script ?? [], has = script.length > 0, c = this.check;
    const busy = this.state !== "idle", ready = this.script !== null && c !== null;
    const warn = (text) => div().text_size(12.5).text_color(th.blocked).child(text);
    return v_flex().size_full().p(18).gap(10).bg(th.popover).text_color(th.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child(t("deleteProfileTitle", { name: this.p.branch ?? this.p.top.split("/").pop() })))
      .child(div().text_color(th.muted).child(t("deleteProfileBody", { path: this.p.top })))
      .when(!ready, (el) => el.child(div().text_size(12).text_color(th.dim).child(t("checking"))))
      .when(Boolean(c?.dirty), (el) => el.child(warn(t("dirtyWarning", { files: c.dirty }))))
      .when(Boolean(c?.unpushed), (el) => el.child(warn(t("unpushedWarning", { count: c.unpushed, branch: this.p.branch }))))
      .when(has, (el) => el.child(div().text_size(12).text_color(th.muted).child(t("teardownWillRun")))
        .child(v_flex().p(10).gap(2).rounded(6).bg(th.raised).font_family("JetBrains Mono").text_size(12)
          .children(script.map((l) => div().truncate().child(`$ ${l}`)))))
      .when(busy, (el) => el.child(div().text_size(12).text_color(th.dim).child(t(this.state === "teardown" ? "tearingDown" : "removing"))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(th.ansi1).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", th, t("cancel"), () => this.close()))
        .when(has, (el) => el.child(button("skip", th, t("skipTeardown"), (_e, cx) => this.run(false, cx), { disabled: busy || !ready })))
        .child(button("delete", th, has ? t("runTeardownDelete") : t("delete"), (_e, cx) => this.run(has, cx), { primary: true, disabled: busy || !ready })));
  }
}
