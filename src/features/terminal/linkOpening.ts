export interface TerminalLinkActivationEvent {
	ctrlKey: boolean;
}

export function shouldBypassTerminalLinkConfirm(
	event: TerminalLinkActivationEvent,
) {
	return event.ctrlKey;
}
