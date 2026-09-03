interface TerminalLinkActivationEvent {
	ctrlKey: boolean;
}

export function isAllowedTerminalLinkScheme(uri: string): boolean {
	try {
		const scheme = new URL(uri).protocol;
		return scheme === "http:" || scheme === "https:";
	} catch {
		return false;
	}
}

export function shouldBypassTerminalLinkConfirm(
	event: TerminalLinkActivationEvent,
) {
	return event.ctrlKey;
}
