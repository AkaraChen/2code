// Deleting a profile: run the worktree's teardown script (2code.json), then
// hand over to Herdr's own Remove worktree dialog, which checks for uncommitted
// work, closes the space and removes the checkout.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, exec, openOverlay, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { readProjectConfig } from "../lib/config.js";
import { button } from "../lib/ui.js";

export class Teardown {
  init(p, cx) {
    this.p = p;
    this.script = null; // null: reading
    this.running = false;
    this.error = null;
    cx.spawn(async (cx) => {
      // 2code reads a project's config from its main checkout, like setup does.
      const config = await readProjectConfig(p.main ?? p.top, p.on);
      this.script = config.teardown_script;
      cx.notify();
    });
  }

  remove() {
    openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: this.p.space, folder: this.p.top, action: "remove" } });
    closeOverlay(props().overlay);
  }

  teardown(cx) {
    if (this.running) return;
    this.running = true; this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        for (const line of this.script) {
          const r = await exec("sh", ["-c", line], { cwd: this.p.top, on: this.p.on, timeout: 600_000 });
          if (r.code !== 0) throw new Error(`${line}: ${(r.stderr || r.stdout).trim() || `exit ${r.code}`}`);
        }
        this.running = false;
        this.remove();
      } catch (e) {
        this.running = false; this.error = String(e?.message ?? e);
        cx.notify();
      }
    });
  }

  render() {
    const th = theme();
    const script = this.script ?? [];
    const has = script.length > 0;
    const close = () => closeOverlay(props().overlay);
    return v_flex().size_full().p(18).gap(12).bg(th.popover).text_color(th.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child(t("teardownTitle", { name: this.p.name ?? "" })))
      .child(div().text_color(th.muted).child(this.script === null ? "…" : t(has ? "teardownBody" : "teardownNone")))
      .when(has, (el) => el.child(v_flex().p(10).gap(2).rounded(6).bg(th.raised).font_family("JetBrains Mono").text_size(12)
        .children(script.map((l) => div().truncate().child(`$ ${l}`)))))
      .when(this.running, (el) => el.child(div().text_color(th.dim).child(t("tearingDown"))))
      .when(Boolean(this.error), (el) => el.child(div().text_color(th.ansi1).text_size(12).child(t("teardownFailed", { error: this.error }))))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", th, t("cancel"), close))
        .when(has && !this.error, (el) => el.child(button("skip", th, t("skipTeardown"), () => this.remove(), { disabled: this.running })))
        .when(Boolean(this.error), (el) => el.child(button("anyway", th, t("continueAnyway"), () => this.remove())))
        .child(has && !this.error
          ? button("run", th, t("runTeardown"), (_e, cx) => this.teardown(cx), { primary: true, disabled: this.running })
          : button("continue", th, t("continue"), () => this.remove(), { primary: true, disabled: this.script === null })));
  }
}
