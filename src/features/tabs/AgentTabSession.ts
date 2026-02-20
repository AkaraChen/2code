import type { AgentNotification } from "@agentclientprotocol/sdk";
import consola from "consola";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { nanoid } from "nanoid";
import {
	closeAgentSession,
	createAgentSessionPersistent,
	deleteAgentSessionRecord,
	listAgentSessionEvents,
	reconnectAgentSession,
} from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useAgentStore } from "../agent/store";
import { TabSession } from "./session";
import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";
import type { AgentTab } from "./types";

export class AgentTabSession extends TabSession {
	readonly type = "agent" as const;
	readonly agentType: string;
	private unlisteners: UnlistenFn[] = [];
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
	) {
		super(id, profileId, title);
		this.agentType = agentType;
	}

	/**
	 * Create a new persistent agent session.
	 * Session and events are automatically persisted to the database.
	 */
	static async create(
		profileId: string,
		cwd: string,
		agent: string,
	): Promise<AgentTabSession> {
		const info = await createAgentSessionPersistent({
			meta: { profileId, agent },
			cwd,
		});
		const session = new AgentTabSession(
			info.id,
			profileId,
			m.agentTabTitle({ agent }),
			agent,
		);
		useAgentStore.getState().initSession(info.id);
		await session.registerListeners();
		session._connected = true;
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
			);

			// Load transferred events and register listeners in parallel
			const [events] = await Promise.all([
				listAgentSessionEvents({ sessionId: info.id }),
				newSession.registerListeners(),
			]);
			useAgentStore.getState().initSession(info.id);
			useAgentStore.getState().restoreFromEvents(info.id, events);
			newSession._connected = true;

			// Replace in registry
			sessionRegistry.delete(this.id);
			sessionRegistry.set(newSession.id, newSession);

			// Update the sessionId on the existing tab (nanoid tab id stays stable)
			const profile = useTabStore.getState().profiles[this.profileId];
			const agentTab = profile?.tabs.find(
				(t): t is AgentTab => t.type === "agent" && t.sessionId === this.id,
			);
			if (agentTab) {
				useTabStore
					.getState()
					.updateAgentSessionId(this.profileId, agentTab.id, newSession.id);
			}

			consola.info(
				`[agent] reconnected ${this.id} → ${info.id}`,
			);
			return newSession;
		} catch (e) {
			this._reconnecting = false;
			throw e;
		}
	}

	async registerListeners(): Promise<void> {
		const [unlistenEvent, unlistenComplete, unlistenError] = await Promise.all([
			listen<AgentNotification>(`agent-event-${this.id}`, (e) => {
				useAgentStore.getState().handleAgentEvent(this.id, e.payload);
			}),
			listen<unknown>(`agent-turn-complete-${this.id}`, (e) => {
				useAgentStore.getState().handleTurnComplete(this.id, e.payload);
			}),
			listen<string>(`agent-error-${this.id}`, (e) => {
				useAgentStore.getState().handleError(this.id, e.payload);
			}),
		]);

		this.unlisteners = [unlistenEvent, unlistenComplete, unlistenError];
	}

	async close(): Promise<void> {
		// Unlisten first (always succeeds)
		for (const unlisten of this.unlisteners) unlisten();
		this.unlisteners = [];

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
		};
	}
}
