import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { AgentSessionState } from "../types";
import { createModelSlice, type ModelSlice } from "./modelSlice";
import { createSessionSlice, type SessionSlice } from "./sessionSlice";

const useMockStore = create<
	ModelSlice & SessionSlice & { sessions: Record<string, AgentSessionState> }
>()(
	immer((...a) => ({
		sessions: {},
		...(createSessionSlice as any)(...a),
		...(createModelSlice as any)(...a),
	})),
);

describe("modelSlice", () => {
	beforeEach(() => {
		useMockStore.setState({ sessions: {} });
		useMockStore.getState().initSession("sess1");
	});

	it("should set model state", () => {
		const state = { config: {} } as any;
		useMockStore.getState().setModelState("sess1", state);
		expect(useMockStore.getState().sessions.sess1.modelState).toBe(state);
	});

	it("should set model loading state", () => {
		useMockStore.getState().setModelLoading("sess1", true);
		expect(useMockStore.getState().sessions.sess1.modelLoading).toBe(true);
	});
});
