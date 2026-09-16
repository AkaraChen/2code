import { Channel } from "@tauri-apps/api/core";
import {
	getSessionAgentStatus,
	getSessionBackend,
	streamHerdrOutput,
	streamSessionAgentStatus,
} from "@/generated";
import type {
	HerdrTerminalFrame,
	RuntimeBackend,
	SessionAgentStatus,
} from "@/generated";

export type TerminalTransportKind = "herdr";

export function transportKindFromBackend(
	_backend: RuntimeBackend,
): TerminalTransportKind {
	return "herdr";
}

/**
 * Per-session ownership. GUI is Herdr-only. Unbound ids are Herdr.
 * Never consult discovery's default-runtime field.
 */
export async function resolveTerminalTransportKind(
	sessionId: string,
): Promise<TerminalTransportKind> {
	await getSessionBackend({ sessionId });
	return "herdr";
}

export function startHerdrFrameStream(options: {
	sessionId: string;
	streamId: string;
	onFrame: (frame: HerdrTerminalFrame) => void;
	onError?: (error: unknown) => void;
}): Channel<HerdrTerminalFrame> {
	const outputChannel = new Channel<HerdrTerminalFrame>();
	outputChannel.onmessage = options.onFrame;
	void streamHerdrOutput({
		sessionId: options.sessionId,
		streamId: options.streamId,
		onOutput: outputChannel,
	}).catch((error) => {
		options.onError?.(error);
	});
	return outputChannel;
}

export async function hydrateHerdrAgentStatus(
	sessionId: string,
): Promise<SessionAgentStatus | null> {
	return getSessionAgentStatus({ sessionId });
}

export function startHerdrAgentStream(options: {
	sessionId: string;
	onUpdate: (dto: SessionAgentStatus) => void;
	onError?: (error: unknown) => void;
}): Channel<SessionAgentStatus> {
	const channel = new Channel<SessionAgentStatus>();
	channel.onmessage = options.onUpdate;
	void streamSessionAgentStatus({
		sessionId: options.sessionId,
		onUpdate: channel,
	}).catch((error) => {
		options.onError?.(error);
	});
	return channel;
}
