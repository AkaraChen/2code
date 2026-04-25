// Phase 2 GitPanel state.
//
// Per-profile state lives under `panelByProfile[profileId]` so switching
// profiles doesn't smear state across them. The shape is small intentionally
// — anything that doesn't survive a reload (selected file, hover state) lives
// in component state, not here.
//
// Persisted to localStorage via the same tauriStorage adapter used by the
// other settings stores. Drafts in particular are valuable — losing a
// half-written commit message because the user navigated away is a Fork-
// level paper cut.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "@/shared/lib/tauriStorage";

export type GitPanelTab = "changes" | "history" | "branches" | "stash";

interface PerProfileState {
	open: boolean;
	tab: GitPanelTab;
	commitDraft: { subject: string; body: string };
	amendLast: boolean;
}

interface GitPanelStore {
	width: number; // px, shared across profiles
	panelByProfile: Record<string, PerProfileState>;

	// derived/getters
	getOpen: (profileId: string) => boolean;
	getTab: (profileId: string) => GitPanelTab;
	getDraft: (profileId: string) => { subject: string; body: string };
	getAmendLast: (profileId: string) => boolean;

	// actions
	setWidth: (px: number) => void;
	togglePanel: (profileId: string) => void;
	setOpen: (profileId: string, open: boolean) => void;
	setTab: (profileId: string, tab: GitPanelTab) => void;
	setDraft: (
		profileId: string,
		patch: Partial<{ subject: string; body: string }>,
	) => void;
	clearDraft: (profileId: string) => void;
	setAmendLast: (profileId: string, amend: boolean) => void;
}

const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 280;
const MAX_WIDTH = 800;

const defaultProfile = (): PerProfileState => ({
	open: false,
	tab: "changes",
	commitDraft: { subject: "", body: "" },
	amendLast: false,
});

function ensureProfile(
	state: GitPanelStore,
	profileId: string,
): PerProfileState {
	return state.panelByProfile[profileId] ?? defaultProfile();
}

export const useGitPanelStore = create<GitPanelStore>()(
	persist(
		(set, get) => ({
			width: DEFAULT_WIDTH,
			panelByProfile: {},

			getOpen: (profileId) =>
				get().panelByProfile[profileId]?.open ?? false,
			getTab: (profileId) =>
				get().panelByProfile[profileId]?.tab ?? "changes",
			getDraft: (profileId) =>
				get().panelByProfile[profileId]?.commitDraft ?? {
					subject: "",
					body: "",
				},
			getAmendLast: (profileId) =>
				get().panelByProfile[profileId]?.amendLast ?? false,

			setWidth: (px) =>
				set({
					width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px))),
				}),

			togglePanel: (profileId) =>
				set((state) => {
					const cur = ensureProfile(state, profileId);
					return {
						panelByProfile: {
							...state.panelByProfile,
							[profileId]: { ...cur, open: !cur.open },
						},
					};
				}),

			setOpen: (profileId, open) =>
				set((state) => {
					const cur = ensureProfile(state, profileId);
					return {
						panelByProfile: {
							...state.panelByProfile,
							[profileId]: { ...cur, open },
						},
					};
				}),

			setTab: (profileId, tab) =>
				set((state) => {
					const cur = ensureProfile(state, profileId);
					return {
						panelByProfile: {
							...state.panelByProfile,
							[profileId]: { ...cur, tab },
						},
					};
				}),

			setDraft: (profileId, patch) =>
				set((state) => {
					const cur = ensureProfile(state, profileId);
					return {
						panelByProfile: {
							...state.panelByProfile,
							[profileId]: {
								...cur,
								commitDraft: { ...cur.commitDraft, ...patch },
							},
						},
					};
				}),

			clearDraft: (profileId) =>
				set((state) => {
					const cur = ensureProfile(state, profileId);
					return {
						panelByProfile: {
							...state.panelByProfile,
							[profileId]: {
								...cur,
								commitDraft: { subject: "", body: "" },
								amendLast: false,
							},
						},
					};
				}),

			setAmendLast: (profileId, amend) =>
				set((state) => {
					const cur = ensureProfile(state, profileId);
					return {
						panelByProfile: {
							...state.panelByProfile,
							[profileId]: { ...cur, amendLast: amend },
						},
					};
				}),
		}),
		{
			name: "git-panel",
			storage: createJSONStorage(() => tauriStorage),
		},
	),
);
