import { Channel } from "@tauri-apps/api/core";
import {
	getSessionAgentStatus,
	getSessionBackend,
	streamHerdrOutput,
	streamPtyOutput,
	streamSessionAgentStatus,
} from "@/generated";
import type {
	HerdrTerminalFrame,
	RuntimeBackend,
	SessionAgentStatus,
} from "@/generated";

export type TerminalTransportKind = "local" | "herdr";

export function transportKindFromBackend(
	backend: RuntimeBackend,
): TerminalTransportKind {
	return backend === "herdr" ? "herdr" : "local";
}

/**
 * Per-session ownership from `RuntimeRouter::backend_for`.
 * Unbound ids are Local. Never consult discovery's default-runtime field.
 */
export async function resolveTerminalTransportKind(
	sessionId: string,
): Promise<TerminalTransportKind> {
	const backend = await getSessionBackend({ sessionId });
	return transportKindFromBackend(backend);
}

export function startLocalByteStream(options: {
	sessionId: string;
	streamId: string;
	onBytes: (bytes: Uint8Array) => void;
	onError?: (error: unknown) => void;
}): Channel<ArrayBuffer> {
	const outputChannel = new Channel<ArrayBuffer>();
	outputChannel.onmessage = (payload) => {
		options.onBytes(new Uint8Array(payload));
	};
	void streamPtyOutput({
		sessionId: options.sessionId,
		streamId: options.streamId,
		onOutput: outputChannel,
	}).catch((error) => {
		options.onError?.(error);
	});
	return outputChannel;
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
