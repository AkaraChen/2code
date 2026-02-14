import type { AgentNotification } from "@agentclientprotocol/sdk";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listen } from "@tauri-apps/api/event";
import { closeAgentSession, spawnAgentSession } from "@/generated";
import { useAgentStore } from "../agent/store";
import { TabSession } from "./session";
import type { AgentTab } from "./types";

export class AgentTabSession extends TabSession {
	readonly type = "agent" as const;
	readonly agentType: string;
	private unlisteners: UnlistenFn[] = [];

	constructor(
		id: string,
		profileId: string,
		title: string,
		agentType: string,
	) {
		super(id, profileId, title);
		this.agentType = agentType;
	}

	static async create(
		profileId: string,
		cwd: string,
		agent: string,
	): Promise<AgentTabSession> {
		const info = await spawnAgentSession({ agent, cwd });
		const session = new AgentTabSession(
			info.id,
			profileId,
			`${agent} session`,
			agent,
		);
		useAgentStore.getState().initSession(info.id);
		await session.registerListeners();
		return session;
	}

	private async registerListeners(): Promise<void> {
		const unlistenEvent = await listen<AgentNotification>(
			`agent-event-${this.id}`,
			(e) => {
				useAgentStore.getState().handleAgentEvent(this.id, e.payload);
			},
		);

		const unlistenComplete = await listen<unknown>(
			`agent-turn-complete-${this.id}`,
			(e) => {
				useAgentStore.getState().handleTurnComplete(this.id, e.payload);
			},
		);

		const unlistenError = await listen<string>(
			`agent-error-${this.id}`,
			(e) => {
				useAgentStore.getState().handleError(this.id, e.payload);
			},
		);

		this.unlisteners = [unlistenEvent, unlistenComplete, unlistenError];
	}

	async close(): Promise<void> {
		for (const unlisten of this.unlisteners) unlisten();
		this.unlisteners = [];
		await closeAgentSession({ sessionId: this.id });
		useAgentStore.getState().removeSession(this.id);
	}

	toTab(): AgentTab {
		return {
			type: "agent",
			id: this.id,
			title: this.title,
			agentType: this.agentType,
		};
	}
}
