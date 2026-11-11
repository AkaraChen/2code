// The terminal templates menu: the project's (2code.json at the checkout's root)
// and the global ones (~/2code/2code.json). Picking one opens a tab named after
// it, in its folder, and types its commands after the project's init script.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { readProjectConfig, readGlobalConfig } from "../lib/config.js";
import { repoOf } from "../lib/git.js";
import { openTerminal, templateFolder } from "../lib/terminal.js";
import { icon } from "../lib/ui.js";

const preview = (commands) => !commands.length ? "" : commands.length === 1 ? commands[0] : `${commands[0]} +${commands.length - 1}`;

export class Templates {
  init(p, cx) {
    this.p = p;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.repo = await repoOf(p.cwd, p.on);
        // The project's config lives in its main checkout; template folders are
        // relative to this checkout.
        this.project = await readProjectConfig(this.repo?.main, p.on);
        this.global = await readGlobalConfig();
      } finally { this.loading = false; cx.notify(); }
    });
  }

  pick(template, scope, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    const top = this.repo?.top;
    cx.spawn(async (cx) => {
      try {
        await openTerminal(cx, {
          space: this.p.space,
          name: template.name,
          folder: templateFolder(template, scope, top, this.p.cwd),
          commands: [...(this.project?.init_script ?? []), ...template.commands],
        });
      } finally { closeOverlay(props().overlay); }
    });
  }

  section(title, list, scope, th) {
    if (!list.length) return [];
    return [
      div().px(10).pt(8).pb(4).text_size(11).text_color(th.dim).child(title),
      ...list.map((tpl) => h_flex().id(`tpl-${scope}-${tpl.id}`).mx(4).px(8).py(6).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(th.hover))
        .on_click((_e, cx) => this.pick(tpl, scope, cx))
        .child(icon("terminal", 14).text_color(th.muted))
        .child(v_flex().min_w(0).flex_1()
          .child(div().truncate().text_color(th.foreground).child(tpl.name))
          .child(div().truncate().text_size(11).text_color(th.dim).font_family("JetBrains Mono").child(preview(tpl.commands))))),
    ];
  }

  render() {
    const th = theme();
    if (this.busy) return div();
    const project = this.project?.terminal_templates ?? [];
    const global = this.global?.terminal_templates ?? [];
    const errors = [this.project, this.global].filter((c) => c?.error).map((c) => `${c.path}: ${c.error}`);
    return v_flex().id("templates").size_full().py(4).text_size(13).bg(th.popover).text_color(th.foreground).overflow_y_scrollbar()
      .children(this.section(t("projectTemplates"), project, "project", th))
      .children(this.section(t("globalTemplates"), global, "global", th))
      .when(!this.loading && !project.length && !global.length, (el) => el.child(div().p(10).text_size(12).text_color(th.dim).child(t("noTemplates"))))
      .children(errors.map((e) => div().px(10).py(4).text_size(11).text_color(th.ansi1).child(e)));
  }
}
