import type { StateCreator } from "zustand";
import type { AgentModelState } from "@/generated";
import type { AgentStore } from "../store";
import { ensureSession } from "./utils";

export interface ModelSlice {
	setModelState: (
		sessionId: string,
		modelState: AgentModelState | null,
	) => void;
	setModelLoading: (sessionId: string, loading: boolean) => void;
}

export const createModelSlice: StateCreator<
	AgentStore,
	[["zustand/immer", never]],
	[],
	ModelSlice
> = (set) => ({
	setModelState: (sessionId, modelState) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);
			session.modelState = modelState;
		}),

	setModelLoading: (sessionId, loading) =>
		set((state) => {
			const session = ensureSession(state.sessions, sessionId);
			session.modelLoading = loading;
		}),
});
