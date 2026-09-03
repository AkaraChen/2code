export async function copyTextToClipboard(text: string): Promise<void> {
	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		return;
	}

	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "true");
	textarea.style.position = "absolute";
	textarea.style.opacity = "0";
	document.body.append(textarea);
	textarea.select();

	const copied = document.execCommand("copy");
	textarea.remove();

	if (!copied) {
		throw new Error("Clipboard copy failed");
	}
}
