import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createMessageSlice, type MessageSlice } from "./messageSlice";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";
import type { AgentSessionState } from "../types";

const useMockStore = create<MessageSlice & SessionSlice & { sessions: Record<string, AgentSessionState> }>()(
	immer((...a) => ({
		sessions: {},
		...(createSessionSlice as any)(...a),
		...(createMessageSlice as any)(...a)
	}))
);

describe("messageSlice", () => {
	beforeEach(() => {
		useMockStore.setState({ sessions: {} });
		useMockStore.getState().initSession("sess1");
	});

	it("should add user message and prepare streaming turn", () => {
		useMockStore.getState().addUserMessage("sess1", "Hello");
		const session = useMockStore.getState().sessions["sess1"];
		expect(session.streamingTurn).toBeDefined();
		expect(session.streamingTurn?.userMessage).toBe("Hello");
		expect(session.streamingTurn?.agentContent).toEqual([]);
	});

	it("should handle turn completion", () => {
		useMockStore.getState().addUserMessage("sess1", "Hello");
		
		useMockStore.getState().handleAgentEvent("sess1", {
			method: "session/update",
			params: {
				update: {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: "Hi" }
				}
			}
		} as any);

		useMockStore.getState().handleTurnComplete("sess1", {});
		
		const session = useMockStore.getState().sessions["sess1"];
		expect(session.streamingTurn).toBeNull();
		expect(session.isStreaming).toBe(false);
		expect(session.turns).toHaveLength(1);
		expect(session.turns[0].userMessage).toBe("Hello");
		expect(session.turns[0].agentContent).toHaveLength(1);
	});
});
