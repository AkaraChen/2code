// Find a file (cmd-k / ctrl-shift-k), like 2code's command palette: the
// checkout's files (tracked and untracked, not ignored), fuzzy-ranked; Enter
// opens one in its own tab.
import { div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, settings, exec, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { git, READ } from "../lib/git.js";
import { fileIcon } from "../lib/fileIcons.js";
import { openFile } from "../lib/editor.js";
import { icon } from "../lib/ui.js";

const LIMIT = 200;

// Subsequence match: consecutive letters, word starts and the file name score
// higher; shorter paths win ties. Null when the query isn't in the path.
export function score(query, path) {
  if (!query) return 0;
  const q = query.toLowerCase(), p = path.toLowerCase(), base = p.lastIndexOf("/") + 1;
  let s = 0, at = -1, run = 0;
  for (const ch of q) {
    const i = p.indexOf(ch, at + 1);
    if (i < 0) return null;
    run = i === at + 1 ? run + 1 : 0;
    s += 1 + run * 2 + (i >= base ? 2 : 0) + (i === 0 || "/._-".includes(p[i - 1]) ? 3 : 0);
    at = i;
  }
  if (p.slice(base).startsWith(q)) s += 10;
  return s - p.length * 0.01;
}

export class Finder {
  init(p, cx) {
    this.p = p;
    this.files = null; this.at = 0;
    this.input = InputState.new({ placeholder: t("findPlaceholder") });
    this.input.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.pick(this.shown()[this.at], cx));
    this.input.focus();
    cx.timer.after(200, () => this.input.focus());
    cx.spawn(async (cx) => {
      const top = await git(p.cwd, ["rev-parse", "--show-toplevel"], p.on);
      this.root = top.ok ? top.out : p.cwd;
      const r = top.ok
        ? await exec("git", [...READ, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: this.root, on: p.on })
        : await exec("sh", ["-c", 'cd "$1" && find . -type f -not -path "*/.git/*" -not -path "*/node_modules/*" | head -20000 | sed "s|^\\./||" | tr "\\n" "\\0"', "x", this.root], { on: p.on });
      this.files = [...new Set(r.stdout.split("\0").filter(Boolean))];
      cx.notify();
    });
  }

  shown() {
    const q = this.input.value().trim().replace(/\s+/g, "");
    if (!this.files) return [];
    if (!q) return this.files.slice(0, LIMIT);
    const out = [];
    for (const f of this.files) { const s = score(q, f); if (s !== null) out.push([s, f]); }
    return out.sort((a, b) => b[0] - a[0]).slice(0, LIMIT).map(([, f]) => f);
  }

  pick(file, cx) {
    if (!file || this.busy) return;
    this.busy = true; cx.notify();
    cx.spawn(async (cx) => {
      try { await openFile(cx, { space: this.p.space, path: `${this.root}/${file}`, on: this.p.on, root: this.root }); }
      finally { closeOverlay(props().overlay); }
    });
  }

  key(e, cx) {
    const n = this.shown().length;
    if (e.key === "escape") return closeOverlay(props().overlay);
    if ((e.key === "down" || e.key === "up") && n) {
      this.at = (this.at + (e.key === "down" ? 1 : n - 1)) % n;
      cx.stop_propagation(); cx.notify();
    }
  }

  render() {
    const th = theme(), dark = Boolean(settings().dark);
    if (this.busy) return div();
    const rows = this.shown();
    return v_flex().id("finder").size_full().bg(th.popover).text_color(th.foreground).text_size(13)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(44).px(14).gap(8).items_center().border_b(1).border_color(th.border)
        .child(icon("search", 15).text_color(th.dim))
        .child(div().flex_1().child(Input.new(this.input).h(32).text_size(14).text_color(th.foreground))))
      .child(v_flex().id("finder-list").flex_1().min_h(0).p(6).gap(1).overflow_y_scrollbar()
        .children(rows.map((f, i) => {
          const at = f.lastIndexOf("/"), name = f.slice(at + 1), dir = at > 0 ? f.slice(0, at) : "";
          return h_flex().id(`fd-${i}`).h(30).flex_none().px(8).gap(8).items_center().rounded(5).cursor_pointer()
            .bg(i === this.at ? th.selected : th.popover).hover((s) => s.bg(th.hover))
            .on_click((_e, cx) => this.pick(f, cx))
            .child(image(fileIcon(f, false, false, dark)).size(15).flex_none())
            .child(div().flex_none().max_w(260).truncate().child(name))
            .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(th.dim).child(dir));
        }))
        .when(this.files === null, (el) => el.child(div().p(10).text_color(th.dim).child("…")))
        .when(this.files !== null && !rows.length, (el) => el.child(div().p(10).text_color(th.dim).child(t("noMatches")))));
  }
}
