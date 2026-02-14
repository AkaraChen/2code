export interface TerminalTab {
	type: "terminal";
	id: string;
	title: string;
}

export interface AgentTab {
	type: "agent";
	id: string;
	title: string;
	agentType: string;
}

/** Discriminated union of all tab types within a profile. */
export type ProfileTab = TerminalTab | AgentTab;
