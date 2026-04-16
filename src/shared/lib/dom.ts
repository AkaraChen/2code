/** Returns true if the event target is inside an interactive input element. */
export function isInteractiveKeyboardTarget(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	return !!target.closest("input, textarea, button, select, [role='textbox']");
}

/** Returns true if the target is an editable DOM element. */
export function isEditableElement(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return false;
	const tagName = target.tagName;
	return (
		target.isContentEditable ||
		tagName === "INPUT" ||
		tagName === "TEXTAREA" ||
		tagName === "SELECT"
	);
}
