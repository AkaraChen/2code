import type { StateCreator } from "zustand";
import type { TabStore } from "../store";
import type { ProfileTabState } from "../types";

export interface ProfileSlice {
	profiles: Record<string, ProfileTabState>;
	removeProfile: (profileId: string) => void;
	restoreProfile: (profileId: string, profileState: ProfileTabState) => void;
}

export const createProfileSlice: StateCreator<
	TabStore,
	[["zustand/immer", never]],
	[],
	ProfileSlice
> = (set) => ({
	profiles: {},
	removeProfile: (profileId) =>
		set((state) => {
			delete state.profiles[profileId];
		}),
	restoreProfile: (profileId, profileState) =>
		set((state) => {
			state.profiles[profileId] = profileState;
		}),
});
