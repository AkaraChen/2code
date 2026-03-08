import consola from "consola";
import type { StateCreator } from "zustand";
import type { AgentSessionEventRecord } from "@/generated";
import type { AgentStore } from "../store";
import type { StreamingTurn } from "../types";
import { ensureSession, flushStreamingTurn, replayAgentEvent } from "./utils";

export interface HistorySlice {
	restoreFromEvents: (
		sessionId: string,
		events: AgentSessionEventRecord[],
	) => void;
}

export const createHistorySlice: StateCreator<
	AgentStore,
	[["zustand/immer", never]],
	[],
	HistorySlice
> = (set) => ({
	restoreFromEvents: (sessionId, events) => {
		consola.log(
			`[AgentStore] restoreFromEvents for ${sessionId}, ${events.length} events`,
		);

		set((state) => {
			const session = ensureSession(state.sessions, sessionId);

			const turnGroups = events.reduce(
				(acc, event) => {
					const turnIdx = event.turn_index;
					if (!acc[turnIdx]) acc[turnIdx] = [];
					acc[turnIdx].push(event);
					return acc;
				},
				{} as Record<number, AgentSessionEventRecord[]>,
			);

			let restoredTurns = 0;

			for (const turnIdxStr of Object.keys(turnGroups).sort(
				(a, b) => Number(a) - Number(b),
			)) {
				const turnIdx = Number(turnIdxStr);
				const turnEvents = turnGroups[turnIdx];

				const userEvent = turnEvents.find((e) => e.sender === "user");

				let userMessage = "";
				if (userEvent) {
					try {
						const payload = JSON.parse(userEvent.payload_json);
						userMessage = payload.text || "";
					} catch (err) {
						consola.warn(
							`Failed to parse user event ${userEvent.id}:`,
							err,
						);
					}
				}

				const tempStreamingTurn: StreamingTurn = {
					userMessage,
					agentContent: [],
				};

				const agentEvents = turnEvents
					.filter((e) => e.sender === "agent")
					.sort((a, b) => a.event_index - b.event_index);

				for (const event of agentEvents) {
					try {
						const payload = JSON.parse(event.payload_json);
						replayAgentEvent(tempStreamingTurn, payload);
					} catch (err) {
						consola.warn(
							`Failed to parse agent event ${event.id}:`,
							err,
						);
					}
				}

				const agentContent = flushStreamingTurn(tempStreamingTurn);

				if (userMessage || agentContent.length > 0) {
					const lastAgentEvent =
						agentEvents.length > 0 ? agentEvents.at(-1) : undefined;
					const timestamp = userEvent?.created_at
						? userEvent.created_at * 1000
						: lastAgentEvent?.created_at
							? lastAgentEvent.created_at * 1000
							: Date.now();

					session.turns.push({
						timestamp,
						userMessage,
						agentContent,
					});
					restoredTurns++;
				}
			}

			consola.log(
				`[AgentStore] restored ${restoredTurns} turns from ${Object.keys(turnGroups).length} turn groups for ${sessionId}`,
			);
		});
	},
});
