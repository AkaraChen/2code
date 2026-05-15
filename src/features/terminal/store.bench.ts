import { enableMapSet, produce } from "immer";
import { bench, describe } from "vitest";
import {
	closeTabState,
	markNotifiedState,
	type ProjectTerminalState,
} from "./store";

enableMapSet();

interface TerminalDataState {
	profiles: Record<string, ProjectTerminalState>;
	notifiedTabs: Set<string>;
}

function createTerminalState(profileCount: number, tabsPerProfile: number) {
	const profiles: Record<string, ProjectTerminalState> = {};
	for (let profileIndex = 0; profileIndex < profileCount; profileIndex += 1) {
		const profileId = `profile-${profileIndex}`;
		const tabs = Array.from({ length: tabsPerProfile }, (_item, tabIndex) => ({
			id: `session-${profileIndex}-${tabIndex}`,
			title: `Terminal ${tabIndex + 1}`,
		}));
		profiles[profileId] = {
			tabs,
			activeTabId: tabs[tabs.length - 1]?.id ?? null,
			counter: tabs.length,
		};
	}

	return {
		profiles,
		notifiedTabs: new Set<string>(),
	} satisfies TerminalDataState;
}

function findProfileIdBySessionId(
	profiles: Record<string, ProjectTerminalState>,
	sessionId: string,
) {
	for (const [profileId, profile] of Object.entries(profiles)) {
		if (profile.tabs.some((tab) => tab.id === sessionId)) {
			return profileId;
		}
	}

	return null;
}

function markNotifiedWithImmer(
	state: TerminalDataState,
	sessionId: string,
) {
	return produce(state, (draft) => {
		const profileId = findProfileIdBySessionId(draft.profiles, sessionId);
		const focusedProfileId: string | null = null;
		if (
			profileId &&
			profileId === focusedProfileId &&
			draft.profiles[profileId]?.activeTabId === sessionId
		) {
			draft.notifiedTabs.delete(sessionId);
			return;
		}

		draft.notifiedTabs.add(sessionId);
	});
}

function closeTabWithImmer(
	state: TerminalDataState,
	profileId: string,
	tabId: string,
) {
	return produce(state, (draft) => {
		const profile = draft.profiles[profileId];
		if (!profile) return;
		const wasActiveTab = tabId === profile.activeTabId;

		draft.notifiedTabs.delete(tabId);

		const idx = profile.tabs.findIndex((t) => t.id === tabId);
		profile.tabs = profile.tabs.filter((t) => t.id !== tabId);

		if (profile.tabs.length === 0) {
			delete draft.profiles[profileId];
			return;
		}

		if (wasActiveTab) {
			const newIdx = Math.min(idx, profile.tabs.length - 1);
			profile.activeTabId = profile.tabs[newIdx].id;
		}
	});
}

describe("terminal store reducers", () => {
	const state = createTerminalState(200, 6);

	bench("immer mark notification", () => {
		markNotifiedWithImmer(state, "session-100-3");
	});

	bench("plain mark notification", () => {
		markNotifiedState(state, "session-100-3");
	});

	bench("immer close tab", () => {
		closeTabWithImmer(state, "profile-100", "session-100-3");
	});

	bench("plain close tab", () => {
		closeTabState(state, "profile-100", "session-100-3");
	});
});
