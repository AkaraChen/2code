import type { StateCreator } from "zustand";
import type { AgentModeState } from "@/generated";
import type { AgentStore } from "../store";
import { ensureSession } from "./utils";

export interface ModeSlice {
	setModeState: (sessionId: string, modeState: AgentModeState | null) => void;
	setModeLoading: (sessionId: string, loading: boolean) => void;
}

export const createModeSlice: StateCreator<
	AgentStore,
	[["zustand/immer", never]],
	[],
	ModeSlice
> = (set) => ({
	setModeState: (sessionId, modeState) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);
			session.modeState = modeState;
		}),

	setModeLoading: (sessionId, loading) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);
			session.modeLoading = loading;
		}),
});
