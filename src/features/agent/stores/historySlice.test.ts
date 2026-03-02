import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AgentSessionState } from "../types";
import { createHistorySlice, type HistorySlice } from "./historySlice";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";

const useMockStore = create<
	HistorySlice &
		SessionSlice & { sessions: Record<string, AgentSessionState> }
>()(
	immer((...a) => ({
		sessions: {},
		...(createSessionSlice as any)(...a),
		...(createHistorySlice as any)(...a),
	})),
);

describe("historySlice", () => {
	beforeEach(() => {
		useMockStore.setState({ sessions: {} });
		useMockStore.getState().initSession("sess1");
	});

	it("should restore correctly from events", () => {
		const userEvent = {
			id: "1",
			session_id: "sess1",
			turn_index: 0,
			event_index: 0,
			sender: "user",
			payload_json: JSON.stringify({ text: "Hello from user" }),
			created_at: 1000,
		};

		const agentEvent = {
			id: "2",
			session_id: "sess1",
			turn_index: 0,
			event_index: 1,
			sender: "agent",
			payload_json: JSON.stringify({
				method: "session/update",
				params: {
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text: "Hello" },
					},
				},
			}),
			created_at: 1001,
		};

		useMockStore
			.getState()
			.restoreFromEvents("sess1", [userEvent, agentEvent]);

		const session = useMockStore.getState().sessions.sess1;
		expect(session.turns).toHaveLength(1);
		expect(session.turns[0].userMessage).toBe("Hello from user");
		expect(session.turns[0].agentContent).toHaveLength(1);
		expect((session.turns[0].agentContent[0] as any).text).toBe("Hello");
	});
});
