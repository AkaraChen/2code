import type { StateCreator } from "zustand";
import type { AgentStore } from "../store";
import { ensureSession } from "./utils";

export interface SessionSlice {
	initSession: (sessionId: string) => void;
	removeSession: (sessionId: string) => void;
}

export const createSessionSlice: StateCreator<
	AgentStore,
	[["zustand/immer", never]],
	[],
	SessionSlice
> = (set) => ({
	initSession: (sessionId) =>
		set((state) => {
			ensureSession(state.sessions, sessionId);
		}),
	removeSession: (sessionId) =>
		set((state) => {
			delete state.sessions[sessionId];
		}),
});
