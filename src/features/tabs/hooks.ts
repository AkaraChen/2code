import { useMutation } from "@tanstack/react-query";
import { match } from "ts-pattern";
import * as m from "@/paraglide/messages.js";
import { AgentTabSession } from "./AgentTabSession";
import { clearPending, markPending } from "./pendingDeletions";
import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";
import { TerminalTabSession } from "./TerminalTabSession";

type CreateTabParams =
	| { type: "terminal"; profileId: string; cwd: string }
	| { type: "agent"; profileId: string; cwd: string; agent: string };

export function useCreateTab() {
	return useMutation({
		mutationFn: async (params: CreateTabParams) => {
			const session = await match(params)
				.with({ type: "terminal" }, async (p) => {
					const counter =
						useTabStore.getState().profiles[p.profileId]?.counter ??
						0;
					return TerminalTabSession.create(
						p.profileId,
						p.cwd,
						m.terminalTabTitle({ n: counter + 1 }),
					);
				})
				.with({ type: "agent" }, (p) =>
					AgentTabSession.create(p.profileId, p.cwd, p.agent),
				)
				.exhaustive();
			sessionRegistry.set(session.id, session);
			return session;
		},
		onSuccess: (session) => {
			useTabStore.getState().addTab(session.profileId, session.toTab());
		},
	});
}

export function useCloseTab() {
	return useMutation({
		mutationFn: async ({ tabId }: { profileId: string; tabId: string }) => {
			// Atomic check-and-set to prevent double-close
			if (!markPending(tabId)) {
				throw new Error(`Tab ${tabId} is already being closed`);
			}

			try {
				const session = sessionRegistry.get(tabId);
				if (session) {
					await session.close();
					sessionRegistry.delete(tabId);
				}
			} finally {
				clearPending(tabId);
			}
		},
		onSettled: (_data, _err, { profileId, tabId }) => {
			useTabStore.getState().closeTab(profileId, tabId);
		},
	});
}
