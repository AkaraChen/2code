import { invoke } from "@tauri-apps/api/core";
import type { Profile } from "@/types";

export const profilesApi = {
	list: (projectId: string) =>
		invoke<Profile[]>("list_profiles", { projectId }),

	get: (id: string) => invoke<Profile>("get_profile", { id }),

	create: (projectId: string, branchName: string) =>
		invoke<Profile>("create_profile", { projectId, branchName }),

	update: (id: string, branchName?: string) =>
		invoke<Profile>("update_profile", {
			id,
			branchName: branchName ?? null,
		}),

	delete: (id: string) => invoke<void>("delete_profile", { id }),
};
