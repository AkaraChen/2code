import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useShallow } from "zustand/react/shallow";

export interface BrowserTab {
	id: string;
	url: string;
	title: string;
}

interface ProfileBrowserState {
	tabs: BrowserTab[];
	activeTabId: string | null;
}

interface BrowserTabsStore {
	profiles: Record<string, ProfileBrowserState>;

	openUrl: (profileId: string, url: string, title?: string) => string | null;
	closeTab: (profileId: string, tabId: string) => void;
	setActiveTab: (profileId: string, tabId: string) => void;
	updateTabTitle: (profileId: string, tabId: string, title: string) => void;
}

function normalizeUrl(url: string): string {
	try {
		const parsed = new URL(url);
		// Remove trailing slash for comparison
		return parsed.href.replace(/\/$/, "");
	} catch {
		return url;
	}
}

function generateTabId(): string {
	return `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useBrowserTabsStore = create<BrowserTabsStore>()(
	persist(
		immer((set, get) => ({
			profiles: {},

			openUrl(profileId, url, title) {
				const normalized = normalizeUrl(url);
				const state = get();
				const profile = state.profiles[profileId];

				// Reuse existing tab with same URL
				if (profile) {
					const existing = profile.tabs.find(
						(tab) => normalizeUrl(tab.url) === normalized,
					);
					if (existing) {
						set((draft) => {
							draft.profiles[profileId].activeTabId = existing.id;
						});
						return null;
					}
				}

				// Create new tab
				const tabId = generateTabId();
				const displayTitle = title ?? extractHostname(url);

				set((draft) => {
					if (!draft.profiles[profileId]) {
						draft.profiles[profileId] = { tabs: [], activeTabId: null };
					}
					draft.profiles[profileId].tabs.push({
						id: tabId,
						url,
						title: displayTitle,
					});
					draft.profiles[profileId].activeTabId = tabId;
				});
				return tabId;
			},

			closeTab(profileId, tabId) {
				set((draft) => {
					const profile = draft.profiles[profileId];
					if (!profile) return;
					const idx = profile.tabs.findIndex((t) => t.id === tabId);
					if (idx === -1) return;
					profile.tabs.splice(idx, 1);
					if (profile.activeTabId === tabId) {
						profile.activeTabId = profile.tabs[Math.min(idx, profile.tabs.length - 1)]?.id ?? null;
					}
				});
			},

			setActiveTab(profileId, tabId) {
				set((draft) => {
					const profile = draft.profiles[profileId];
					if (!profile) return;
					profile.activeTabId = tabId;
				});
			},

			updateTabTitle(profileId, tabId, title) {
				set((draft) => {
					const profile = draft.profiles[profileId];
					if (!profile) return;
					const tab = profile.tabs.find((t) => t.id === tabId);
					if (tab) tab.title = title;
				});
			},
		})),
		{ name: "2code-browser-tabs" },
	),
);

function extractHostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

export function useBrowserTabs(profileId: string) {
	return useBrowserTabsStore(
		useShallow((state) => state.profiles[profileId] ?? { tabs: [], activeTabId: null }),
	);
}
