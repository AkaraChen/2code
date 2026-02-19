import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AgentSettingsStore {
	defaultAgent: string;
	setDefaultAgent: (agentId: string) => void;
}

export const useAgentSettingsStore = create<AgentSettingsStore>()(
	persist(
		(set) => ({
			defaultAgent: "claude",
			setDefaultAgent: (agentId) => set({ defaultAgent: agentId }),
		}),
		{ name: "agent-settings", version: 1 },
	),
);
