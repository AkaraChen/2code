import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";
import type { AgentTab } from "./types";

export async function closeAllTabsForProfile(profileId: string): Promise<void> {
	const tabs = useTabStore.getState().profiles[profileId]?.tabs ?? [];

	const promises = tabs.flatMap((tab) => {
		if (tab.type === "terminal") {
			// Close all pane sessions for terminal tabs
			return tab.panes.map(async (pane) => {
				const session = sessionRegistry.get(pane.sessionId);
				if (session) {
					try {
						await session.close();
					} catch (err) {
						console.error(`Failed to close pane session ${pane.sessionId}:`, err);
					} finally {
						sessionRegistry.delete(pane.sessionId);
					}
				}
			});
		}
		// Agent tabs — look up by sessionId, not nanoid tab id
		const agentTab = tab as AgentTab;
		const session = sessionRegistry.get(agentTab.sessionId);
		if (!session) return [];
		return [
			session
				.close()
				.catch((err) => console.error(`Failed to close agent tab ${agentTab.sessionId}:`, err))
				.finally(() => sessionRegistry.delete(agentTab.sessionId)),
		];
	});

	await Promise.allSettled(promises);
	useTabStore.getState().removeProfile(profileId);
}

export async function closeAllTabsForProfiles(
	profileIds: string[],
): Promise<void> {
	await Promise.allSettled(profileIds.map(closeAllTabsForProfile));
}
