import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AgentSessionState } from "./types";
import { type SessionSlice, createSessionSlice } from "./stores/sessionSlice";
import { type MessageSlice, createMessageSlice } from "./stores/messageSlice";
import { type ModelSlice, createModelSlice } from "./stores/modelSlice";
import { type HistorySlice, createHistorySlice } from "./stores/historySlice";

export interface AgentStore
	extends SessionSlice,
		MessageSlice,
		ModelSlice,
		HistorySlice {
	sessions: Record<string, AgentSessionState>;
}

export const useAgentStore = create<AgentStore>()(
	immer((...a) => ({
		sessions: {},
		...createSessionSlice(...a),
		...createMessageSlice(...a),
		...createModelSlice(...a),
		...createHistorySlice(...a),
	})),
);
