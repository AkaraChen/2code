/** Returns true if the event target is inside an interactive input element. */
export function isInteractiveKeyboardTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return !!target.closest("input, textarea, button, select, [role='textbox']");
}
