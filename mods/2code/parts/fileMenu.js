// Right-click menu on the file tree, with 2code's items, and its dialogs:
// new file / folder, rename and delete.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, setShared, closeOverlay, openOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { reveal } from "../lib/os.js";
import { openFile, requestEditor, baseName } from "../lib/editor.js";
import { createFile, createFolder, rename, remove, removePermanently, openDefault, parentOf } from "../lib/fileops.js";
import { icon, button } from "../lib/ui.js";

const refresh = () => setShared("2code.filesRefresh", Date.now());

export class FileMenu {
  init(p) {
    this.p = p;
  }

  items() {
    const { path, dir, root, on, space } = this.p, local = !on;
    const rel = path.startsWith(root + "/") ? path.slice(root.length + 1) : path;
    const folder = dir ? path : parentOf(path);
    const dialog = (part, extra = {}) => () => openOverlay({ mod: "2code", kind: "dialog", width: 440, height: 220, props: { part, root, on, ...extra } });
    return [
      ...(!dir ? [["file", t("open"), (cx) => openFile(cx, { space, path, on, root })]] : []),
      ...(local ? [["external-link", t("openDefault"), () => openDefault(path)], ["folder", t("reveal"), () => reveal(dir ? path : parentOf(path))]] : []),
      ["plus", t("newFile"), dialog("filePrompt", { mode: "file", folder })],
      ["folder", t("newFolder"), dialog("filePrompt", { mode: "folder", folder })],
      ["square-pen", t("rename"), dialog("filePrompt", { mode: "rename", path })],
      ["copy", t("copyRelativePath"), (cx) => cx.write_to_clipboard(rel)],
      ["copy", t("copyAbsolutePath"), (cx) => cx.write_to_clipboard(path)],
      ["undo", t("refresh"), () => refresh()],
      ["x", t("delete"), dialog("fileDelete", { path, dir })],
    ];
  }

  // A popup's tasks end when it closes: run the action to the end first.
  pick(action, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try { await action(cx); } finally { closeOverlay(props().overlay); }
    });
  }

  render() {
    const th = theme();
    if (this.busy) return div();
    return v_flex().id("file-menu").size_full().p(4).gap(1).bg(th.popover).text_color(th.foreground).text_size(13)
      .children(this.items().map(([glyph, label, action], i) => h_flex().id(`fm-${i}`).h(28).px(8).gap(8).items_center().rounded(5).cursor_pointer()
        .hover((s) => s.bg(th.hover)).on_click((_e, cx) => this.pick(action, cx))
        .child(icon(glyph, 13).text_color(th.muted)).child(div().flex_1().truncate().child(label))));
  }
}

// New file, new folder or rename: one name field.
export class FilePrompt {
  init(p, cx) {
    this.p = p;
    const current = p.mode === "rename" ? p.path.split("/").pop() : "";
    this.input = InputState.new({ value: current, placeholder: t(p.mode === "folder" ? "folderNamePlaceholder" : "fileNamePlaceholder") });
    if (current) this.input.set_selected_range({ start: 0, end: current.includes(".") ? current.lastIndexOf(".") : current.length });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.input.focus();
    cx.timer.after(300, () => this.input.focus());
  }

  go(cx) {
    const name = this.input.value().trim();
    if (!name || this.busy) return;
    const { mode, on, root } = this.p;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (mode === "rename") await rename(this.p.path, `${parentOf(this.p.path)}/${name}`, on);
        else if (mode === "folder") await createFolder(`${this.p.folder}/${name}`, on);
        else {
          const path = `${this.p.folder}/${name}`;
          await createFile(path, on);
          await openFile(cx, { path, on, root });
        }
        refresh();
        closeOverlay(props().overlay);
      } catch (e) { this.error = String(e?.message ?? e); }
      finally { this.busy = false; cx.notify(); }
    });
  }

  render() {
    const th = theme(), mode = this.p.mode;
    return v_flex().size_full().p(18).gap(10).bg(th.popover).text_color(th.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child(t(mode === "rename" ? "rename" : mode === "folder" ? "newFolder" : "newFile")))
      .child(div().text_size(12).text_color(th.dim).truncate().child(mode === "rename" ? this.p.path : this.p.folder))
      .child(div().px(10).rounded(6).border_1().border_color(th.accent).bg(th.background).child(Input.new(this.input).h(32).text_size(13).text_color(th.foreground)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(th.ansi1).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", th, t("cancel"), () => closeOverlay(props().overlay)))
        .child(button("ok", th, t(mode === "rename" ? "rename" : "create"), (_e, cx) => this.go(cx), { primary: true, disabled: this.busy })));
  }
}

export class FileDelete {
  init(p) {
    this.p = p;
  }

  // Trash first; when the trash refuses (some mounts have none), say so and
  // let the person choose to delete for good.
  go(cx, permanently = false) {
    if (this.busy) return;
    this.busy = true; this.error = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        await (permanently ? removePermanently : remove)(this.p.path, this.p.on);
        refresh(); closeOverlay(props().overlay);
      } catch (e) { this.error = String(e?.message ?? e); this.trashFailed = !permanently; }
      finally { this.busy = false; cx.notify(); }
    });
  }

  render() {
    const th = theme(), name = this.p.path.split("/").pop();
    return v_flex().size_full().p(18).gap(10).bg(th.popover).text_color(th.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child(t("deleteFileTitle", { name })))
      .child(div().text_color(th.muted).child(t(this.p.dir ? "deleteFolderBody" : "deleteFileBody")))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(th.ansi1).child(this.error)))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", th, t("cancel"), () => closeOverlay(props().overlay)))
        .when(Boolean(this.trashFailed), (el) => el.child(button("delete-forever", th, t("deletePermanently"), (_e, cx) => this.go(cx, true), { disabled: this.busy })))
        .child(button("delete", th, t("delete"), (_e, cx) => this.go(cx), { primary: true, disabled: this.busy })));
  }
}

// Closing a tab with unsaved edits: Save / Don't Save / Cancel. The file's
// editor is shown (its tab was selected first) and acts on the request.
export class Unsaved {
  init(p) {
    this.p = p;
  }

  answer(action) {
    requestEditor(this.p.path, this.p.on ?? null, action);
    closeOverlay(props().overlay);
  }

  render() {
    const th = theme();
    return v_flex().size_full().p(18).gap(10).bg(th.popover).text_color(th.foreground).text_size(13)
      .child(div().text_size(15).font_semibold().child(t("unsavedTitle", { name: baseName(this.p.path) })))
      .child(div().text_color(th.muted).child(t("unsavedBody")))
      .child(div().flex_1())
      .child(h_flex().gap(8).justify_end()
        .child(button("cancel", th, t("cancel"), () => closeOverlay(props().overlay)))
        .child(button("dont-save", th, t("dontSave"), () => this.answer("discard-close")))
        .child(button("save", th, t("save"), () => this.answer("save-close"), { primary: true })));
  }
}
