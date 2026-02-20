import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";

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
		// Agent tabs — single session
		const session = sessionRegistry.get(tab.id);
		if (!session) return [];
		return [
			session
				.close()
				.catch((err) => console.error(`Failed to close tab ${tab.id}:`, err))
				.finally(() => sessionRegistry.delete(tab.id)),
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
