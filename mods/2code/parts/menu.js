// Right-click menus for a project row and a profile row (popups at the pointer).
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, run, openOverlay, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { reveal } from "../lib/os.js";
import { icon } from "../lib/ui.js";
import { openNewProfile, deleteProfile } from "./sidebar.js";

export class Menu {
  init(p) {
    this.p = p;
  }

  items() {
    const { kind, target: x } = this.p;
    const local = !x.machine;
    const project = { path: x.path, machine: x.machine, on: x.machine, name: x.name };
    if (kind === "project") return [
      ["plus", t("newProfile"), () => openNewProfile(project)],
      ["square-pen", t("rename"), () => openOverlay({ mod: "2code", kind: "dialog", width: 420, height: 220, props: { part: "rename", path: x.path, machine: x.machine, name: x.name } })],
      ["settings", t("projectSettings"), () => openOverlay({ mod: "2code", kind: "dialog", width: 640, height: 0.8, props: { part: "projectSettings", path: x.path, machine: x.machine, name: x.name } })],
      ...(local ? [["folder", t("reveal"), () => reveal(x.path)]] : []),
      ["x", t("removeProject"), () => openOverlay({ mod: "2code", kind: "dialog", width: 440, height: 220, props: { part: "removeProject", path: x.path, machine: x.machine, name: x.name } })],
    ];
    return [
      ["terminal", t("open"), () => (x.space ? run("space.select", { id: x.space }) : run("space.new", { folder: x.top, machine: x.machine ?? "" }))],
      ...(local ? [["folder", t("reveal"), () => reveal(x.top)]] : []),
      ...(!x.main ? [["x", t("deleteProfile"), () => deleteProfile(project, { path: x.top, branch: x.branch, space: x.space ? { id: x.space } : null })]] : []),
    ];
  }

  // A popup's tasks end when it closes, so an action runs to the end first and
  // the popup draws nothing meanwhile.
  pick(action, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async () => {
      try { await action(); } finally { closeOverlay(props().overlay); }
    });
  }

  render() {
    const th = theme();
    if (this.busy) return div();
    return v_flex().id("menu").size_full().p(4).gap(1).bg(th.popover).text_color(th.foreground).text_size(13)
      .children(this.items().map(([glyph, label, action], i) => h_flex().id(`menu-${i}`).h(30).px(8).gap(8).items_center().rounded(5).cursor_pointer()
        .hover((s) => s.bg(th.hover))
        .on_click((_e, cx) => this.pick(action, cx))
        .child(icon(glyph, 14).text_color(th.muted))
        .child(div().flex_1().truncate().child(label))));
  }
}
