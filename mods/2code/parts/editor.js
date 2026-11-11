// A file in its own tab, like 2code's file viewer: an editor with syntax
// highlighting and save (cmd-s / ctrl-s), unsaved dot, reload when the file
// changes on disk (or a choice when there are unsaved edits), a recovery copy
// while unsaved (Herdr can close a tab without asking), markdown edit / split /
// preview, and images. Uses Herdr's own Editor (no CodeMirror: there's no web
// view); files on other machines open read-only (writeTextFile is local).
import { div, image } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { theme, settings, shared, focused, readTextFile, writeTextFile, appHome, exec, run } from "herdr";
import * as fs from "fs/promises";
import { t } from "../lib/i18n.js";
import { fileIcon } from "../lib/fileIcons.js";
import { fileKey, setDirty } from "../lib/editor.js";
import { isImage, imageSize, fit } from "../lib/changes.js";
import { button } from "../lib/ui.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", json5: "json", svelte: "html", vue: "html", htm: "html", zsh: "bash", sh: "bash", yml: "yaml", py: "python", rb: "ruby", rs: "rust", md: "markdown", mdx: "markdown" };
const MARKDOWN = /\.(md|mdx|markdown)$/i;
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

export class EditorPart {
  static COMMANDS = ["save"];

  command(name, cx) {
    if (name === "save") this.save(cx);
  }

  init(p, cx) {
    this.path = p.path; this.on = p.on ?? null; this.root = p.root ?? null;
    this.key = fileKey(this.path, this.on); this.id = hash(this.key);
    this.kind = "loading"; // text | markdown | image | binary | missing | error
    this.mode = localStorage.getItem("mdMode") ?? "split";
    this.readonly = Boolean(this.on);
    this.state = null; this.saved = null; this.dirty = false; this.banner = null; this.request = null;
    this.recovery = `${appHome()}/mods/2code/.cache/recovery/${this.id}.txt`; this.recovered = null;
    cx.spawn(async (cx) => { await this.load(cx); });
    cx.timer.every(3000, (cx) => this.poll(cx));
    cx.timer.every(1500, () => { this.keepRecovery(); });
  }

  async load(cx) {
    try {
      if (isImage(this.path) && !this.on) {
        const ext = this.path.split(".").pop(), rel = `mods/2code/.cache/view/${this.id}.${ext}`;
        await exec("mkdir", ["-p", `${appHome()}/mods/2code/.cache/view`]);
        const r = await exec("cp", [this.path, `${appHome()}/${rel}`]);
        if (r.code !== 0) throw new Error(r.stderr);
        this.image = { rel, size: await imageSize(rel) };
        this.kind = "image";
        return;
      }
      const text = await readTextFile(this.path, { on: this.on });
      if (text === null) { this.kind = "missing"; return; }
      if (text.includes("\0")) { this.kind = "binary"; return; }
      this.saved = text;
      // A tab closed while unsaved leaves its flag behind; a fresh load is clean.
      setDirty(this.path, this.on, false);
      this.makeState(text);
      this.kind = MARKDOWN.test(this.path) ? "markdown" : "text";
      if (!this.readonly) {
        const rec = await fs.readFile(this.recovery, "utf8").catch(() => null);
        if (rec !== null && rec !== text) this.banner = { kind: "recover", text: rec };
      }
    } catch (e) {
      this.kind = "error"; this.error = String(e?.message ?? e);
    } finally { cx.notify(); }
  }

  makeState(text) {
    const th = theme(), ext = this.path.includes(".") ? this.path.split(".").pop().toLowerCase() : "txt";
    this.state = EditorState.new({
      language: LANG[ext] ?? ext, value: text, readonly: this.readonly,
      font_family: settings().font_family, font_size: 13,
      syntax: { keyword: th.ansi5, string: th.ansi2, comment: th.dim, function: th.ansi4, type: th.ansi3, number: th.ansi1, constant: th.ansi6 },
    });
    this.state.on("change", (_e, cx) => this.changed(cx));
  }

  changed(cx) {
    const dirty = this.state.value() !== this.saved;
    if (dirty !== this.dirty) { this.dirty = dirty; setDirty(this.path, this.on, dirty); cx.notify(); }
    else if (this.kind === "markdown" && this.mode !== "edit") cx.notify();
  }

  // While unsaved, a copy lives in the mod's cache; it goes once saved or discarded.
  keepRecovery() {
    if (this.readonly || !this.state) return;
    const text = this.dirty ? this.state.value() : null;
    if (text === this.recovered) return;
    this.recovered = text;
    if (text === null) fs.unlink(this.recovery).catch(() => {});
    else fs.mkdir(`${appHome()}/mods/2code/.cache/recovery`, { recursive: true }).then(() => fs.writeFile(this.recovery, text)).catch(() => {});
  }

  markSaved(text) {
    this.saved = text; this.dirty = false; this.banner = null;
    setDirty(this.path, this.on, false);
    this.recovered = null; fs.unlink(this.recovery).catch(() => {});
  }

  save(cx, then) {
    if (this.readonly || !this.state || this.saving) return;
    if (!this.dirty) { then?.(); return; }
    const text = this.state.value();
    this.saving = true; cx.notify();
    cx.spawn(async (cx) => {
      try { await writeTextFile(this.path, text, this.saved); this.markSaved(text); then?.(); }
      catch { this.banner = { kind: "conflict" }; }
      finally { this.saving = false; cx.notify(); }
    });
  }

  // Changed on disk: take it when nothing's unsaved, else ask.
  poll(cx) {
    if (!this.state || this.polling || this.saving) return;
    this.polling = true;
    cx.spawn(async (cx) => {
      try {
        const disk = await readTextFile(this.path, { on: this.on }).catch(() => undefined);
        if (disk === undefined || disk === null || disk === this.saved || this.banner?.kind === "changed") return;
        if (!this.dirty) { this.saved = disk; this.state.set_value(disk); }
        else this.banner = { kind: "changed", disk };
        cx.notify();
      } finally { this.polling = false; }
    });
  }

  reload(cx) {
    cx.spawn(async (cx) => {
      const disk = await readTextFile(this.path, { on: this.on }).catch(() => null);
      if (disk === null) return;
      this.state.set_value(disk); this.markSaved(disk);
      cx.notify();
    });
  }

  myTab() {
    return focused()?.tab ?? null;
  }

  // Close buttons on the tab strip ask the shown editor through shared state.
  handleRequest(cx) {
    const req = shared("2code.editorRequest");
    if (!req || req.key !== this.key || req.nonce === this.request) return;
    this.request = req.nonce;
    const close = () => { const id = this.myTab(); if (id) run("tab.close", { id, confirmed: true }); };
    if (req.action === "save-close") this.save(cx, close);
    else if (req.action === "discard-close") { if (this.state) this.state.set_value(this.saved ?? ""); this.markSaved(this.saved ?? ""); close(); }
  }

  async close() {
    if (this.dirty && this.state && !this.readonly) {
      await fs.mkdir(`${appHome()}/mods/2code/.cache/recovery`, { recursive: true }).catch(() => {});
      await fs.writeFile(this.recovery, this.state.value()).catch(() => {});
    }
  }

  bannerRow(th) {
    const b = this.banner;
    if (!b) return null;
    const row = (text, actions) => h_flex().px(12).py(8).gap(8).items_center().bg(th.blocked + "22").border_b(1).border_color(th.border).text_size(12.5)
      .child(div().flex_1().min_w(0).child(text)).children(actions);
    if (b.kind === "recover") return row(t("recoverBanner"), [
      button("recover-no", th, t("discard"), (_e, cx) => { this.banner = null; fs.unlink(this.recovery).catch(() => {}); cx.notify(); }),
      button("recover-yes", th, t("restore"), (_e, cx) => { this.state.set_value(b.text); this.banner = null; cx.notify(); }, { primary: true })]);
    if (b.kind === "changed") return row(t("changedOnDisk"), [
      button("keep-mine", th, t("keepMine"), (_e, cx) => { this.saved = b.disk; this.banner = null; cx.notify(); }),
      button("reload", th, t("reload"), (_e, cx) => this.reload(cx), { primary: true })]);
    return row(t("saveConflict"), [
      button("reload", th, t("reload"), (_e, cx) => this.reload(cx)),
      button("overwrite", th, t("overwrite"), (_e, cx) => cx.spawn(async (cx) => {
        this.saved = await readTextFile(this.path, { on: this.on }).catch(() => null); this.banner = null; this.save(cx);
      }), { primary: true })]);
  }

  body(th) {
    const code = () => Editor.new(this.state).id(`ed-${this.id}`).absolute().inset_0();
    const preview = () => div().id(`md-${this.id}`).absolute().inset_0().p(20).overflow_y_scrollbar()
      .child(TextView.markdown(`mdv-${this.id}`, this.state.value()).selectable().on_link_click((url, cx) => cx.open_url(url)));
    const box = (child) => div().flex_1().min_w(0).min_h(0).relative().child(child);
    if (this.kind === "text") return box(code());
    if (this.kind === "markdown") {
      if (this.mode === "edit") return box(code());
      if (this.mode === "preview") return box(preview());
      // h_flex centers its children; the halves hold only absolute children, so give them the height.
      return h_flex().flex_1().min_h(0).child(box(code()).h_full()).child(div().w(1).h_full().bg(th.border)).child(box(preview()).h_full());
    }
    if (this.kind === "image") {
      const s = fit(this.image.size, 900, 640);
      return div().flex_1().min_h(0).flex().items_center().justify_center().bg(th.canvas)
        .child(v_flex().gap(8).items_center().child(image(this.image.rel).w(s.w).h(s.h))
          .when(Boolean(this.image.size), (el) => el.child(div().text_size(11).text_color(th.dim).child(`${this.image.size.w} × ${this.image.size.h}`))));
    }
    const note = { loading: t("fileLoading"), binary: t("fileBinary"), missing: t("fileGone"), error: `${t("fileUnreadable")} ${this.error ?? ""}` }[this.kind];
    return div().flex_1().p(20).text_color(th.dim).child(note ?? "");
  }

  render(cx) {
    const th = theme();
    shared("2code.locale");
    this.handleRequest(cx);
    const rel = this.root && this.path.startsWith(this.root + "/") ? this.path.slice(this.root.length + 1) : this.path;
    const seg = (mode, label) => div().id(`m-${mode}`).h(24).px(9).flex().items_center().rounded(5).cursor_pointer().text_size(12)
      .bg(this.mode === mode ? th.background : th.raised).text_color(this.mode === mode ? th.foreground : th.dim)
      .on_click((_e, cx) => { this.mode = mode; localStorage.setItem("mdMode", mode); cx.notify(); }).child(label);
    return v_flex().id(`editor-${this.id}`).size_full().min_h(0).bg(th.background).text_color(th.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(th.border)
        .child(image(fileIcon(this.path, false, false, settings().dark)).size(15).flex_none())
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(th.muted).child(rel))
        .when(this.dirty, (el) => el.child(div().size(7).rounded(4).bg(th.foreground).flex_none()))
        .when(this.readonly && Boolean(this.state), (el) => el.child(div().text_size(11).text_color(th.dim).child(t("readOnly"))))
        .when(this.kind === "markdown", (el) => el.child(h_flex().p(2).gap(2).rounded(6).bg(th.raised)
          .child(seg("edit", t("mdEdit"))).child(seg("split", t("mdSplit"))).child(seg("preview", t("mdPreview")))))
        .when(Boolean(this.state) && !this.readonly, (el) => el.child(button("save", th, this.saving ? t("saving") : t("save"), (_e, cx) => this.save(cx), { disabled: !this.dirty || this.saving }))))
      .when(Boolean(this.banner), (el) => el.child(this.bannerRow(th)))
      .child(this.body(th));
  }
}
