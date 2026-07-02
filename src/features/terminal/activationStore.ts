import { create } from "zustand";

export const HOT_PROFILE_LIMIT = 3;

interface TerminalActivationStore {
	lastActivatedAt: Record<string, number>;
	markProfileActivated: (profileId: string, activatedAt?: number) => void;
	reset: () => void;
}

let renderedHotProfileIds = new Set<string>();

export const useTerminalActivationStore = create<TerminalActivationStore>()(
	(set) => ({
		lastActivatedAt: {},

		markProfileActivated(profileId, activatedAt = Date.now()) {
			set((state) => ({
				lastActivatedAt: {
					...state.lastActivatedAt,
					[profileId]: activatedAt,
				},
			}));
		},

		reset() {
			set({ lastActivatedAt: {} });
			renderedHotProfileIds = new Set();
		},
	}),
);

export function markTerminalProfileActivated(profileId: string) {
	useTerminalActivationStore.getState().markProfileActivated(profileId);
}

export function getTerminalLastActivatedAt() {
	return useTerminalActivationStore.getState().lastActivatedAt;
}

export function selectHotProfileIds(
	allIds: readonly string[],
	activeId: string | null,
	lastActivatedAt: Record<string, number>,
	limit = HOT_PROFILE_LIMIT,
): string[] {
	const uniqueIds = [...new Set(allIds)];
	const activeIsOpen = activeId !== null && uniqueIds.includes(activeId);
	const otherIds = uniqueIds.filter((id) => id !== activeId);
	const recentIds = [...otherIds]
		.sort((a, b) => {
			const byActivatedAt =
				(lastActivatedAt[b] ?? 0) - (lastActivatedAt[a] ?? 0);
			if (byActivatedAt !== 0) return byActivatedAt;
			return uniqueIds.indexOf(a) - uniqueIds.indexOf(b);
		})
		.slice(0, Math.max(0, limit));

	return activeIsOpen && activeId ? [activeId, ...recentIds] : recentIds;
}

export function setRenderedHotProfileIds(profileIds: readonly string[]) {
	renderedHotProfileIds = new Set(profileIds);
}

export function isRenderedProfileHot(profileId: string) {
	return renderedHotProfileIds.has(profileId);
}
