import { div, svg } from "gpui-kit";

export const ICON = "mods/2code/icons";
export const icon = (name, size = 14) => svg(`${ICON}/${name}.svg`).size(size).flex_none();
export const stop = (_e, cx) => cx.stop_propagation();

// 2code's agent dots: running pulses, waiting is yellow, finished is green.
export function dot(status, t) {
  if (status === "working") return div().size(7).flex_none().rounded(4).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1200 });
  if (status === "blocked") return div().size(7).flex_none().rounded(4).bg(t.blocked);
  if (status === "done") return div().size(7).flex_none().rounded(4).bg(t.done);
  return null;
}

const urgency = { blocked: 3, done: 2, working: 1, idle: 0 };
export const worst = (statuses) => statuses.filter(Boolean).sort((a, b) => urgency[b] - urgency[a])[0] ?? null;

export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// A plain button: `label` is text or an element.
export function button(id, t, label, onClick, { primary = false, disabled = false } = {}) {
  return div().id(id).h(30).px(12).flex().items_center().justify_center().rounded(6).text_size(12.5)
    .border_1().border_color(primary ? t.solid : t.border)
    .bg(primary ? (disabled ? t.raised : t.solid) : t.background)
    .text_color(primary ? (disabled ? t.dim : t.solid_foreground) : t.foreground)
    .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.opacity(0.85)).on_click(onClick))
    .child(label);
}
