import { sessionRegistry } from "./sessionRegistry";
import { useTabStore } from "./store";

export async function closeAllTabsForProfile(profileId: string): Promise<void> {
	const tabs = useTabStore.getState().profiles[profileId]?.tabs ?? [];

	const promises = tabs.map(async (tab) => {
		const session = sessionRegistry.get(tab.id);
		if (session) {
			try {
				await session.close();
			} catch (err) {
				console.error(`Failed to close tab ${tab.id}:`, err);
			} finally {
				sessionRegistry.delete(tab.id);
			}
		}
	});

	await Promise.allSettled(promises);
	useTabStore.getState().removeProfile(profileId);
}

export async function closeAllTabsForProfiles(
	profileIds: string[],
): Promise<void> {
	await Promise.allSettled(profileIds.map(closeAllTabsForProfile));
}
