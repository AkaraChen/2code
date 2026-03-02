import type { StateCreator } from "zustand";
import type { SettingsStore } from "./index";

export interface AgentSlice {
	defaultAgent: string;
	setDefaultAgent: (agentId: string) => void;
}

export const createAgentSlice: StateCreator<
	SettingsStore,
	[["zustand/immer", never]],
	[],
	AgentSlice
> = (set) => ({
	defaultAgent: "claude",
	setDefaultAgent: (agentId) => set({ defaultAgent: agentId }),
});
