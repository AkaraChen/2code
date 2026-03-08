import consola from "consola";
import { nanoid } from "nanoid";
import { Channel } from "@tauri-apps/api/core";
import { match } from "ts-pattern";
import type {
	AgentNotification,
	SessionNotification,
} from "@agentclientprotocol/sdk";
import {
	closeAgentSession,
	createAgentSessionPersistent,
	deleteAgentSessionRecord,
	getAgentSessionModes,
	getAgentSessionModels,
	listAgentSessionEvents,
	playSystemSound,
	reconnectAgentSession,
	sendAgentPrompt,
	setAgentSessionMode,
	setAgentSessionModel,
} from "@/generated";
import { useSettingsStore } from "../settings/stores";
import { TabSession } from "../tabs/session";
import type { AgentTab } from "../tabs/types";
import { useAgentStore } from "./store";
import type { AgentEvent } from "@/generated/types";

/**
 * Parse ACP SessionNotification from AgentEvent params JSON string.
 */
function parseSessionNotification(params: string): SessionNotification | null {
	try {
		return JSON.parse(params) as SessionNotification;
	} catch {
		return null;
	}
}

export class AgentTabSession extends TabSession {
	readonly type = "agent" as const;
	readonly agentType: string;
	readonly iconUrl: string | null;
	private _connected = false;
	private _reconnecting = false;

	get connected(): boolean {
		return this._connected;
	}

	constructor(
		id: string,
		profileId: string,
		title: string,
		agentType: string,
		iconUrl?: string | null,
	) {
		super(id, profileId, title);
		this.agentType = agentType;
		this.iconUrl = iconUrl ?? null;
	}

	/**
	 * Create a new persistent agent session.
	 * Session and events are automatically persisted to the database.
	 *
	 * @param profileId The profile ID to associate with this session (for multi-profile support).
	 * @param cwd       The initial working directory for the agent process.
	 * @param agent     The agent identifier (e.g. marketplace record ID or local agent ID).
	 * @param agentName The display name of the agent (for the tab title).
	 * @param iconUrl   Icon URL from the marketplace agent record.
	 */
	static async create(
		profileId: string,
		cwd: string,
		agent: string,
		agentName: string,
		iconUrl?: string | null,
	): Promise<AgentTabSession> {
		const info = await createAgentSessionPersistent({
			meta: { profileId, agent },
			cwd,
		});
		const session = new AgentTabSession(
			info.id,
			profileId,
			agentName,
			agent,
			iconUrl,
		);
		useAgentStore.getState().initSession(info.id);
		session._connected = true;
		await session.refreshModelState();
		await session.refreshModeState();
		return session;
	}

	/**
	 * Reconnect a restored session on demand (called when tab is focused).
	 * Spawns the agent process, transfers events, sets up listeners.
	 * The tab nanoid id remains stable — only the backend sessionId changes.
	 */
	async reconnect(): Promise<AgentTabSession> {
		if (this._connected || this._reconnecting) {
			return this;
		}
		this._reconnecting = true;

		try {
			const info = await reconnectAgentSession({
				oldSessionId: this.id,
			});

			// Create new session object with the new backend session ID
			const newSession = new AgentTabSession(
				info.id,
				this.profileId,
				this.title,
				this.agentType,
				this.iconUrl,
			);

			// Load transferred events
			const events = await listAgentSessionEvents({ sessionId: info.id });
			useAgentStore.getState().initSession(info.id);
			useAgentStore.getState().restoreFromEvents(info.id, events);
			newSession._connected = true;
			await newSession.refreshModelState();
			await newSession.refreshModeState();

			// Replace in registry
			this.unregister();
			newSession.register();

			// Update the sessionId on the existing tab (nanoid tab id stays stable)
			const profile = this.tabStore.profiles[this.profileId];
			const agentTab = profile?.tabs.find(
				(t): t is AgentTab =>
					t.type === "agent" && t.sessionId === this.id,
			);
			if (agentTab) {
				this.tabStore.updateAgentSessionId(
					this.profileId,
					agentTab.id,
					newSession.id,
				);
			}

			consola.info(`[agent] reconnected ${this.id} → ${info.id}`);
			return newSession;
		} catch (e) {
			this._reconnecting = false;
			throw e;
		}
	}

	/**
	 * Send a prompt to the agent session.
	 * Uses Tauri Channel to receive events:
	 * - Standard ACP notifications (AgentNotification)
	 * - Application-level events (TurnComplete, Error)
	 */
	async sendPrompt(content: string): Promise<void> {
		const channel = new Channel<AgentEvent>();

		channel.onmessage = (event) => {
			console.error("[agent] channel event:", event);
			// Handle discriminated union by type field
			match(event)
				.with({ type: "TurnComplete" }, (e) => {
					console.error("[agent] TurnComplete received", e);
					// Application-level turn complete
					useAgentStore.getState().handleTurnComplete(this.id, {
						type: "turn_complete",
						sessionId: e.session_id,
						stopReason: e.stop_reason,
					});

					// Play notification sound
					const { notificationEnabled, notificationSound } =
						useSettingsStore.getState();
					if (notificationEnabled && notificationSound) {
						void playSystemSound({ name: notificationSound }).catch(
							(err) => {
								consola.warn(
									"[agent] failed to play completion sound:",
									err,
								);
							},
						);
					}
				})
				.with({ type: "Error" }, (e) => {
					// Application-level error
					useAgentStore.getState().handleError(this.id, e.message);
				})
				.with({ type: "Notification" }, (e) => {
					// Standard ACP notification - parse params as SessionNotification
					const sessionNotification = parseSessionNotification(
						e.params,
					);
					if (sessionNotification) {
						// Construct AgentNotification structure expected by handleAgentEvent
						const agentNotification: AgentNotification = {
							method: e.method,
							params: sessionNotification,
						};
						useAgentStore
							.getState()
							.handleAgentEvent(this.id, agentNotification);
					}
				})
				.otherwise(() => {
					// Unknown event type
					console.error("[agent] unknown event shape:", event);
				});
		};

		await sendAgentPrompt({
			sessionId: this.id,
			content,
			onEvent: channel,
		});
	}

	async refreshModelState(): Promise<void> {
		useAgentStore.getState().setModelLoading(this.id, true);
		try {
			const modelState = await getAgentSessionModels({
				sessionId: this.id,
			});
			useAgentStore.getState().setModelState(this.id, modelState);
		} catch (err) {
			consola.warn(
				`[agent] failed to load model state for ${this.id}:`,
				err,
			);
			useAgentStore.getState().setModelState(this.id, null);
		} finally {
			useAgentStore.getState().setModelLoading(this.id, false);
		}
	}

	async refreshModeState(): Promise<void> {
		useAgentStore.getState().setModeLoading(this.id, true);
		try {
			const modeState = await getAgentSessionModes({
				sessionId: this.id,
			});
			useAgentStore.getState().setModeState(this.id, modeState);
		} catch (err) {
			consola.warn(
				`[agent] failed to load mode state for ${this.id}:`,
				err,
			);
			useAgentStore.getState().setModeState(this.id, null);
		} finally {
			useAgentStore.getState().setModeLoading(this.id, false);
		}
	}

	async setModel(modelId: string): Promise<void> {
		useAgentStore.getState().setModelLoading(this.id, true);
		try {
			const modelState = await setAgentSessionModel({
				sessionId: this.id,
				modelId,
			});
			useAgentStore.getState().setModelState(this.id, modelState);
		} finally {
			useAgentStore.getState().setModelLoading(this.id, false);
		}
	}

	async setMode(modeId: string): Promise<void> {
		useAgentStore.getState().setModeLoading(this.id, true);
		try {
			const modeState = await setAgentSessionMode({
				sessionId: this.id,
				modeId,
			});
			useAgentStore.getState().setModeState(this.id, modeState);
		} finally {
			useAgentStore.getState().setModeLoading(this.id, false);
		}
	}

	async close(): Promise<void> {
		try {
			// Close runtime session and delete database record
			await Promise.all([
				closeAgentSession({ sessionId: this.id }),
				deleteAgentSessionRecord({ sessionId: this.id }),
			]);
		} catch (err) {
			consola.error(`Failed to close agent session ${this.id}:`, err);
			// Continue with state cleanup even if backend fails
		}

		useAgentStore.getState().removeSession(this.id);
	}

	toTab(): AgentTab {
		return {
			type: "agent",
			id: nanoid(),
			sessionId: this.id,
			title: this.title,
			agentType: this.agentType,
			iconUrl: this.iconUrl,
		};
	}
}
