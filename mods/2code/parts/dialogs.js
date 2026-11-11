// Small project dialogs: rename and remove.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, spaces, run, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { renameProject, removeProject, projectName } from "../lib/projects.js";
import { place, repoOf } from "../lib/git.js";
import { button } from "../lib/ui.js";

const close = () => closeOverlay(props().overlay);

function frame(th, title, body, actions) {
  return v_flex().size_full().p(18).gap(12).bg(th.popover).text_color(th.foreground).text_size(13)
    .child(div().text_size(15).font_semibold().child(title))
    .children(body)
    .child(div().flex_1())
    .child(h_flex().gap(8).justify_end().children(actions));
}

export class Rename {
  init(p, cx) {
    this.p = p;
    const derived = projectName({ path: p.path });
    this.input = InputState.new({ value: p.name ?? "", placeholder: derived });
    this.input.on("submit", () => this.save());
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  save() {
    const derived = projectName({ path: this.p.path });
    const name = this.input.value().trim();
    renameProject(this.p.path, this.p.machine ?? null, name === derived ? "" : name);
    close();
  }

  render() {
    const th = theme();
    return frame(th, t("rename"), [
      div().text_size(12).text_color(th.muted).child(t("projectName")),
      div().px(10).rounded(6).border_1().border_color(th.accent).bg(th.background).child(Input.new(this.input).h(32).text_size(13).text_color(th.foreground)),
      div().text_size(11.5).text_color(th.dim).child(t("namePlaceholder")),
    ], [button("cancel", th, t("cancel"), close), button("save", th, t("save"), () => this.save(), { primary: true })]);
  }
}

// Removing a project takes it off the list and closes its open spaces
// (their terminals end); nothing on disk changes.
export class RemoveProject {
  init(p, cx) {
    this.p = p;
    this.spaces = null;
    cx.spawn(async (cx) => {
      const mine = [];
      for (const s of spaces()) {
        if ((s.machine ?? null) !== (p.machine ?? null)) continue;
        const r = await repoOf(place(s), s.machine).catch(() => null);
        if ((r?.main ?? place(s)) === p.path) mine.push(s.id);
      }
      this.spaces = mine;
      cx.notify();
    });
  }

  remove() {
    for (const id of this.spaces ?? []) run("space.close", { id, confirmed: true });
    removeProject(this.p.path, this.p.machine ?? null);
    close();
  }

  render() {
    const th = theme();
    return frame(th, t("removeProjectTitle", { name: this.p.name }), [
      div().text_color(th.muted).child(t("removeProjectBody", { name: this.p.name })),
      div().text_size(12).text_color(th.dim).child(this.spaces === null ? "…" : t("openSpaces", { count: this.spaces.length })),
    ], [button("cancel", th, t("cancel"), close), button("remove", th, t("remove"), () => this.remove(), { primary: true, disabled: this.spaces === null })]);
  }
}
