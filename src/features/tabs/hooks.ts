import { useMutation } from "@tanstack/react-query";
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
			let session;
			switch (params.type) {
				case "terminal": {
					const counter =
						useTabStore.getState().profiles[params.profileId]
							?.counter ?? 0;
					session = await TerminalTabSession.create(
						params.profileId,
						params.cwd,
						`Terminal ${counter + 1}`,
					);
					break;
				}
				case "agent": {
					session = await AgentTabSession.create(
						params.profileId,
						params.cwd,
						params.agent,
					);
					break;
				}
			}
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
