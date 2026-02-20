export interface TerminalPane {
	sessionId: string;
	title: string;
}

export interface TerminalTab {
	type: "terminal";
	id: string;
	title: string;
	panes: TerminalPane[];
	activePaneId: string;
}

export interface AgentTab {
	type: "agent";
	/** Frontend nanoid — stable across restarts, never used for backend calls. */
	id: string;
	/** Backend agent session ID — may change on reconnect. */
	sessionId: string;
	title: string;
	agentType: string;
}

/** Discriminated union of all tab types within a profile. */
export type ProfileTab = TerminalTab | AgentTab;
