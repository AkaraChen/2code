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
		mutationFn: async ({ tabId, profileId }: { profileId: string; tabId: string }) => {
			// Atomic check-and-set to prevent double-close
			if (!markPending(tabId)) {
				throw new Error(`Tab ${tabId} is already being closed`);
			}

			try {
				const tab = useTabStore.getState().profiles[profileId]?.tabs.find(
					(t) => t.id === tabId,
				);

				if (tab?.type === "terminal") {
					// Close all pane sessions
					await Promise.all(
						tab.panes.map(async (pane) => {
							const session = sessionRegistry.get(pane.sessionId);
							if (session) {
								await session.close();
								sessionRegistry.delete(pane.sessionId);
							}
						}),
					);
				} else {
					// Agent tabs — single session
					const session = sessionRegistry.get(tabId);
					if (session) {
						await session.close();
						sessionRegistry.delete(tabId);
					}
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

export function useCreatePane() {
	return useMutation({
		mutationFn: async ({
			profileId,
			tabId,
			cwd,
		}: { profileId: string; tabId: string; cwd: string }) => {
			const tab = useTabStore
				.getState()
				.profiles[profileId]?.tabs.find((t) => t.id === tabId);
			if (!tab || tab.type !== "terminal") {
				throw new Error("Tab not found or not a terminal tab");
			}
			if (tab.panes.length >= 4) {
				throw new Error("Maximum 4 panes per tab");
			}

			const session = await TerminalTabSession.create(
				profileId,
				cwd,
				`Pane ${tab.panes.length + 1}`,
			);
			sessionRegistry.set(session.id, session);
			return { session, tabId };
		},
		onSuccess: ({ session, tabId }, { profileId }) => {
			useTabStore.getState().addPane(profileId, tabId, {
				sessionId: session.id,
				title: session.title,
			});
		},
	});
}

export function useClosePane() {
	return useMutation({
		mutationFn: async ({
			paneSessionId,
		}: { profileId: string; tabId: string; paneSessionId: string }) => {
			const session = sessionRegistry.get(paneSessionId);
			if (session) {
				await session.close();
				sessionRegistry.delete(paneSessionId);
			}
		},
		onSettled: (_data, _err, { profileId, tabId, paneSessionId }) => {
			useTabStore.getState().closePane(profileId, tabId, paneSessionId);
		},
	});
}
