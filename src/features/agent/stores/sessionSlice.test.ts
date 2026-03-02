import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";
import type { AgentSessionState } from "../types";

const useMockStore = create<SessionSlice & { sessions: Record<string, AgentSessionState> }>()(
	immer((...a) => ({
		sessions: {},
		...(createSessionSlice as any)(...a)
	}))
);

describe("sessionSlice", () => {
	beforeEach(() => {
		useMockStore.setState({ sessions: {} });
	});

	it("should initialize a session", () => {
		useMockStore.getState().initSession("sess1");
		const session = useMockStore.getState().sessions["sess1"];
		expect(session).toBeDefined();
		expect(session.turns).toEqual([]);
		expect(session.isStreaming).toBe(false);
	});

	it("should remove a session", () => {
		useMockStore.getState().initSession("sess1");
		useMockStore.getState().removeSession("sess1");
		expect(useMockStore.getState().sessions["sess1"]).toBeUndefined();
	});
});
