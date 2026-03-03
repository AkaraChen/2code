import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createHistorySlice, type HistorySlice } from "./stores/historySlice";
import { createMessageSlice, type MessageSlice } from "./stores/messageSlice";
import { createModelSlice, type ModelSlice } from "./stores/modelSlice";
import { createModeSlice, type ModeSlice } from "./stores/modeSlice";
import { createSessionSlice, type SessionSlice } from "./stores/sessionSlice";
import type { AgentSessionState } from "./types";

export interface AgentStore
	extends SessionSlice,
		MessageSlice,
		ModelSlice,
		ModeSlice,
		HistorySlice {
	sessions: Record<string, AgentSessionState>;
}

export const useAgentStore = create<AgentStore>()(
	immer((...a) => ({
		sessions: {},
		...createSessionSlice(...a),
		...createMessageSlice(...a),
		...createModelSlice(...a),
		...createModeSlice(...a),
		...createHistorySlice(...a),
	})),
);
