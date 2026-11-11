// 2code's terminal tabs: a line-style strip, then "+ New Terminal" with a
// templates menu beside it.
import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, run, theme, openOverlay, shared } from "herdr";
import { t } from "../lib/i18n.js";
import { readProjectConfig } from "../lib/config.js";
import { repoOf, here } from "../lib/git.js";
import { openTerminal } from "../lib/terminal.js";
import { icon, dot } from "../lib/ui.js";

export class Tabs {
  newTerminal(cx) {
    const { space, cwd, on } = here();
    cx.spawn(async (cx) => {
      const repo = await repoOf(cwd, on);
      const config = await readProjectConfig(repo?.main, on);
      await openTerminal(cx, { space: space?.id, folder: cwd ?? undefined, commands: config.init_script });
    });
  }

  templates() {
    const { space, cwd, on } = here();
    openOverlay({ mod: "2code", kind: "popup", width: 300, height: 360, props: { part: "templates", space: space?.id, cwd, on } });
  }

  tab(c, th) {
    const pane = panes().find((p) => p.tab === c.id && p.program?.agent) ?? panes().find((p) => p.tab === c.id);
    const program = pane?.program;
    const name = c.named ? c.name : (pane?.title || program?.name || t("newTerminal"));
    const glyph = program?.icon && !program.shell
      ? (program.tint ? svg(program.icon).size(14).flex_none().text_color(th.muted) : image(program.icon).size(14).flex_none())
      : icon("terminal", 14);
    return h_flex().id(`tab-${c.id}`).h_full().px(10).gap(7).items_center().flex_none().max_w(220).cursor_pointer()
      .border_b(2).border_color(c.active ? th.foreground : th.background)
      .text_color(c.active ? th.foreground : th.dim).hover((s) => s.text_color(th.foreground))
      .on_click(() => run("tab.select", { id: c.id }))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: here().space?.id } } }); })
      .child(glyph)
      .child(div().min_w(0).truncate().child(name))
      .when(Boolean(dot(c.status, th)), (el) => el.child(dot(c.status, th)))
      .child(div().id(`tab-close-${c.id}`).size(16).flex().items_center().justify_center().rounded(4).text_color(th.dim)
        .hover((s) => s.bg(th.hover).text_color(th.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); })
        .child(icon("x", 11)));
  }

  render(cx) {
    const th = theme();
    shared("2code.language"); shared("2code.locale");
    const tabs = here().space?.tabs ?? [];
    return h_flex().size_full().pl(4).gap(2).items_end().bg(th.background).border_b(1).border_color(th.border).text_size(13)
      // overflow_x_scrollbar() wraps the strip, so it takes the free width (flex_1) to scroll in.
      .child(h_flex().id("tab-strip").flex_1().h_full().min_w(0).gap(2).items_end().overflow_x_scrollbar().children(tabs.map((c) => this.tab(c, th))))
      .child(h_flex().h_full().flex_none().items_center()
        .child(h_flex().id("tab-new").h_full().pl(10).pr(4).gap(6).items_center().cursor_pointer().text_color(th.dim)
          .hover((s) => s.text_color(th.foreground))
          .on_click((_e, cx) => this.newTerminal(cx))
          .child(icon("plus", 13)).child(t("newTerminal")))
        .child(div().id("tab-templates").h(22).w(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(th.dim)
          .hover((s) => s.bg(th.hover).text_color(th.foreground))
          .on_click(() => this.templates())
          .child(icon("chevron-down", 13))));
  }
}
