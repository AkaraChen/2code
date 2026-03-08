import type { AgentNotification, SessionNotification } from "@agentclientprotocol/sdk";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { match, P } from "ts-pattern";

/**
 * ACP Agent Event Types
 *
 * Standard ACP notifications from the agent SSE stream.
 */
export interface AcpEvent {
	type: "acp";
	payload: AgentNotification;
}

/**
 * Application-level Turn Complete
 *
 * Emitted when the prompt() Promise resolves on the backend.
 */
export interface TurnCompleteEvent {
	type: "turn_complete";
	payload: {
		session_id: string;
		stop_reason: string;
	};
}

/**
 * Application-level Error
 *
 * Emitted when the prompt() Promise rejects on the backend.
 */
export interface ErrorEvent {
	type: "error";
	payload: string;
}

/**
 * Unified Agent Stream Event
 *
 * All events from the agent session are normalized to this union type.
 */
export type AgentStreamEvent = AcpEvent | TurnCompleteEvent | ErrorEvent;

/**
 * Mode Update Extracted from ACP Stream
 */
export interface ModeUpdate {
	modeId: string;
}

/**
 * Callback types for specific event handlers
 */
export type AgentStreamHandler = (event: AgentStreamEvent) => void;
export type AcpNotificationHandler = (notification: SessionNotification) => void;
export type ModeUpdateHandler = (update: ModeUpdate) => void;
export type ErrorHandler = (error: string) => void;
export type TurnCompleteHandler = () => void;

/**
 * Agent Stream Service
 *
 * Encapsulates the multi-channel Tauri event listening for an agent session
 * and exposes a unified event stream interface.
 *
 * ## Architecture
 *
 * Backend sends 3 channels:
 * - `agent-stream-${id}`     → Standard ACP notifications (AgentNotification)
 * - `agent-turn-complete-${id}` → App-level prompt completion signal
 * - `agent-error-${id}`      → App-level prompt error signal
 *
 * This service normalizes all 3 into a single `AgentStreamEvent` union type.
 *
 * ## Usage
 *
 * ```typescript
 * const service = new AgentStreamService(sessionId);
 *
 * service.onEvent((event) => {
 *   match(event)
 *     .with({ type: "acp" }, (e) => handleAcp(e.payload))
 *     .with({ type: "turn_complete" }, () => handleDone())
 *     .with({ type: "error" }, (e) => handleError(e.payload))
 *     .exhaustive();
 * });
 *
 * await service.start();
 *
 * // Later
 * service.stop();
 * ```
 */
export class AgentStreamService {
	readonly sessionId: string;

	private unlisteners: UnlistenFn[] = [];
	private handlers: Set<AgentStreamHandler> = new Set();
	private modeHandlers: Set<ModeUpdateHandler> = new Set();
	private errorHandlers: Set<ErrorHandler> = new Set();
	private completeHandlers: Set<TurnCompleteHandler> = new Set();

	constructor(sessionId: string) {
		this.sessionId = sessionId;
	}

	/**
	 * Start listening to all agent event channels.
	 *
	 * Must be called before events will be received.
	 */
	async start(): Promise<void> {
		if (this.unlisteners.length > 0) {
			throw new Error("AgentStreamService already started");
		}

		const [acpUnlisten, completeUnlisten, errorUnlisten] = await Promise.all([
			// ACP notification stream (session/update, etc.)
			listen<AgentNotification>(`agent-stream-${this.sessionId}`, (e) => {
				this.handleAcpNotification(e.payload);
			}),

			// Application-level turn complete signal
			listen<unknown>(`agent-turn-complete-${this.sessionId}`, (e) => {
				const payload = this.parseTurnCompletePayload(e.payload);
				this.emit({ type: "turn_complete", payload });
				this.completeHandlers.forEach((h) => h());
			}),

			// Application-level error signal
			listen<string>(`agent-error-${this.sessionId}`, (e) => {
				this.emit({ type: "error", payload: e.payload });
				this.errorHandlers.forEach((h) => h(e.payload));
			}),
		]);

		this.unlisteners = [acpUnlisten, completeUnlisten, errorUnlisten];
	}

	/**
	 * Stop listening and clean up all event handlers.
	 */
	stop(): void {
		for (const unlisten of this.unlisteners) {
			unlisten();
		}
		this.unlisteners = [];
		this.handlers.clear();
		this.modeHandlers.clear();
		this.errorHandlers.clear();
		this.completeHandlers.clear();
	}

	/**
	 * Subscribe to all agent stream events.
	 *
	 * Returns an unsubscribe function.
	 */
	onEvent(handler: AgentStreamHandler): () => void {
		this.handlers.add(handler);
		return () => this.handlers.delete(handler);
	}

	/**
	 * Subscribe to ACP notifications only.
	 *
	 * Returns an unsubscribe function.
	 */
	onAcpNotification(handler: AcpNotificationHandler): () => void {
		const wrapper: AgentStreamHandler = (event) => {
			match(event)
				.with({ type: "acp" }, (e) => {
					if (e.payload.method === "session/update" && e.payload.params) {
						handler(e.payload.params as SessionNotification);
					}
				})
				.otherwise(() => {
					// Ignore non-ACP events
				});
		};
		return this.onEvent(wrapper);
	}

	/**
	 * Subscribe to mode update events (extracted from ACP stream).
	 *
	 * Returns an unsubscribe function.
	 */
	onModeUpdate(handler: ModeUpdateHandler): () => void {
		this.modeHandlers.add(handler);
		return () => this.modeHandlers.delete(handler);
	}

	/**
	 * Subscribe to error events.
	 *
	 * Returns an unsubscribe function.
	 */
	onError(handler: ErrorHandler): () => void {
		this.errorHandlers.add(handler);
		return () => this.errorHandlers.delete(handler);
	}

	/**
	 * Subscribe to turn complete events.
	 *
	 * Returns an unsubscribe function.
	 */
	onTurnComplete(handler: TurnCompleteHandler): () => void {
		this.completeHandlers.add(handler);
		return () => this.completeHandlers.delete(handler);
	}

	/**
	 * Get an async iterator over all agent stream events.
	 *
	 * Note: Events are buffered while no consumer is waiting.
	 */
	async *events(): AsyncIterableIterator<AgentStreamEvent> {
		const buffer: AgentStreamEvent[] = [];
		let resolveNext: ((event: AgentStreamEvent) => void) | null = null;

		const unsubscribe = this.onEvent((event) => {
			if (resolveNext) {
				resolveNext(event);
				resolveNext = null;
			} else {
				buffer.push(event);
			}
		});

		try {
			while (this.unlisteners.length > 0) {
				const event =
					buffer.shift() ??
					(new Promise<AgentStreamEvent>((resolve) => {
						resolveNext = resolve;
					}));
				yield await event;
			}
		} finally {
			unsubscribe();
		}
	}

	private handleAcpNotification(payload: AgentNotification): void {
		// Check for mode update first (extracted from session/update)
		match(payload)
			.with(
				{
					method: "session/update",
					params: {
						update: { sessionUpdate: "current_mode_update" },
					},
				},
				(payload) => {
					const modeId = (payload.params?.update as { modeId?: string })?.modeId;
					if (modeId) {
						this.modeHandlers.forEach((h) => h({ modeId }));
					}
				},
			)
			.otherwise(() => {
				// Other ACP notifications pass through as-is
			});

		this.emit({ type: "acp", payload });
	}

	private emit(event: AgentStreamEvent): void {
		this.handlers.forEach((h) => h(event));
	}

	private parseTurnCompletePayload(raw: unknown): TurnCompleteEvent["payload"] {
		return match(raw)
			.with(
				{ session_id: P.string },
				(payload) => ({
					session_id: payload.session_id,
					stop_reason: (payload as { stop_reason?: string }).stop_reason ?? "unknown",
				}),
			)
			.otherwise(() => ({
				session_id: this.sessionId,
				stop_reason: "unknown",
			}));
	}
}

/**
 * Create and start an AgentStreamService in one call.
 */
export async function createAgentStream(
	sessionId: string,
): Promise<AgentStreamService> {
	const service = new AgentStreamService(sessionId);
	await service.start();
	return service;
}
