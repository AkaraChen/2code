// The review queue: comments collected in the diff dialog, per repo, kept in
// shared state. "Copy for agent" puts them on the clipboard in 2code's format.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, theme, shared, closeOverlay } from "herdr";
import { t } from "../lib/i18n.js";
import { button, icon } from "../lib/ui.js";
import { reviewList, setReviewList } from "./diff.js";

const block = (text) => String(text ?? "").replace(/\r\n/g, "\n").replace(/\n+$/, "");

export function formatForAgent(comments) {
  return [
    "Please address these review comments:",
    "",
    ...comments.flatMap((c, i) => [
      `${i + 1}. ${c.file}:${c.range}`,
      "Selected diff:",
      "```diff",
      block(c.code) || "(no selected text available)",
      "```",
      "Comment:",
      block(c.body),
      "",
    ]),
  ].join("\n");
}

export class Review {
  init(p) {
    this.root = p.root;
  }

  copy(cx, clear) {
    const list = reviewList(this.root);
    if (!list.length) return;
    cx.write_to_clipboard(formatForAgent(list));
    if (clear) setReviewList(this.root, []);
    this.copied = true;
    cx.notify();
    if (clear) closeOverlay(props().overlay);
  }

  render() {
    const th = theme();
    shared("2code.review"); shared("2code.locale");
    const list = reviewList(this.root);
    return v_flex().size_full().bg(th.popover).text_color(th.foreground).text_size(13)
      .child(h_flex().px(18).pt(16).pb(10).gap(8).items_center().border_b(1).border_color(th.border)
        .child(icon("message", 15).text_color(th.muted))
        .child(div().flex_1().text_size(15).font_semibold().child(t("reviewTitle", { count: list.length }))))
      .child(v_flex().id("review-list").flex_1().min_h(0).p(14).gap(10).overflow_y_scrollbar()
        .children(list.map((c, i) => v_flex().id(`rc-${i}`).p(10).gap(6).rounded(8).border_1().border_color(th.border)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(`${c.file}:${c.range}`))
            .child(div().id(`rc-del-${i}`).size(22).flex().items_center().justify_center().rounded(5).cursor_pointer().text_color(th.dim)
              .hover((s) => s.bg(th.hover).text_color(th.ansi1))
              .on_click((_e, cx) => { setReviewList(this.root, list.filter((_x, j) => j !== i)); cx.notify(); })
              .child(icon("x", 12))))
          .child(div().p(8).rounded(6).bg(th.raised).font_family("JetBrains Mono").text_size(11.5).text_color(th.muted)
            .children(block(c.code).split("\n").slice(0, 12).map((l) => div().truncate().child(l || " "))))
          .child(div().child(c.body))))
        .when(!list.length, (el) => el.child(div().text_color(th.dim).child(t("reviewEmpty")))))
      .child(h_flex().px(18).py(12).gap(8).items_center().border_t(1).border_color(th.border)
        .child(div().flex_1().text_size(12).text_color(th.dim).child(this.copied ? t("copied") : ""))
        .child(button("close", th, t("close"), () => closeOverlay(props().overlay)))
        .child(button("copy-clear", th, t("copyAndClear"), (_e, cx) => this.copy(cx, true), { disabled: !list.length }))
        .child(button("copy", th, h_flex().gap(6).items_center().child(icon("copy", 13)).child(t("copyForAgent")), (_e, cx) => this.copy(cx, false), { primary: true, disabled: !list.length })));
  }
}
