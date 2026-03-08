import { useMutation } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { AgentTabSession } from "@/features/agent/AgentTabSession";
import * as m from "@/paraglide/messages.js";
import { clearPending, markPending } from "./pendingDeletions";
import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";
import { TerminalTabSession } from "./TerminalTabSession";
import type { AgentTab, PendingTab } from "./types";
import type { TabSession } from "./session";

type CreateTabParams =
	| { type: "terminal"; profileId: string; cwd: string }
	| {
			type: "agent";
			profileId: string;
			cwd: string;
			agent: string;
			agentName: string;
			iconUrl?: string | null;
	  };

export function useCreateTab() {
	return useMutation({
		mutationFn: async (params: CreateTabParams) => {
			const tempId = nanoid();
			let promise: Promise<TabSession>;

			if (params.type === "terminal") {
				const counter =
					useTabStore.getState().profiles[params.profileId]
						?.counter ?? 0;
				promise = TerminalTabSession.create(
					params.profileId,
					params.cwd,
					m.terminalTabTitle({ n: counter + 1 }),
				);
			} else {
				promise = AgentTabSession.create(
					params.profileId,
					params.cwd,
					params.agent,
					params.agentName,
					params.iconUrl,
				);
			}

			const pendingTab: PendingTab = {
				type: "pending",
				id: tempId,
				title:
					params.type === "agent"
						? params.agentName
						: m.newTerminal(),
				intendedType: params.type,
				iconUrl: params.type === "agent" ? params.iconUrl : undefined,
				promise,
			};

			useTabStore.getState().addTab(params.profileId, pendingTab);

			try {
				const session = await promise;
				sessionRegistry.set(session.id, session);
				return { session, optimisticTabId: tempId };
			} catch (error) {
				useTabStore.getState().closeTab(params.profileId, tempId);
				throw error;
			}
		},
		onSuccess: ({ session, optimisticTabId }, variables) => {
			const finalTab = session.toTab();
			finalTab.id = optimisticTabId; // Re-use nanoid so React elements don't unmount
			useTabStore
				.getState()
				.replaceTab(variables.profileId, optimisticTabId, finalTab);
		},
	});
}

export function useCloseTab() {
	return useMutation({
		mutationFn: async ({
			tabId,
			profileId,
		}: {
			profileId: string;
			tabId: string;
		}) => {
			// Atomic check-and-set to prevent double-close
			if (!markPending(tabId)) {
				throw new Error(`Tab ${tabId} is already being closed`);
			}

			try {
				const state = useTabStore.getState();
				const tab = state.profiles[profileId]?.tabs.find(
					(t) => t.id === tabId,
				);

				// Optimistically close the tab in UI
				state.closeTab(profileId, tabId);

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
				} else if (tab?.type === "agent") {
					// Agent tabs — look up by sessionId, not nanoid tab id
					const agentTab = tab as AgentTab;
					const session = sessionRegistry.get(agentTab.sessionId);
					if (session) {
						await session.close();
						sessionRegistry.delete(agentTab.sessionId);
					}
				}
			} finally {
				clearPending(tabId);
			}
		},
	});
}

export function useCreatePane() {
	const tabStore = useTabStore();
	return useMutation({
		mutationFn: async ({
			profileId,
			tabId,
			cwd,
		}: {
			profileId: string;
			tabId: string;
			cwd: string;
		}) => {
			const tab = tabStore.profiles[profileId]?.tabs.find(
				(t) => t.id === tabId,
			);
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
			tabStore.addPane(profileId, tabId, {
				sessionId: session.id,
				title: session.title,
			});
		},
	});
}

export function useClosePane() {
	const tabStore = useTabStore();
	return useMutation({
		mutationFn: async ({
			paneSessionId,
		}: {
			profileId: string;
			tabId: string;
			paneSessionId: string;
		}) => {
			const session = sessionRegistry.get(paneSessionId);
			if (session) {
				await session.close();
				sessionRegistry.delete(paneSessionId);
			}
		},
		onSettled: (_data, _err, { profileId, tabId, paneSessionId }) => {
			tabStore.closePane(profileId, tabId, paneSessionId);
		},
	});
}
