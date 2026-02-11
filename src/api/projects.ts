import { invoke } from "@tauri-apps/api/core";
import type { Project } from "@/types";

export const projectsApi = {
	list: () => invoke<Project[]>("list_projects"),

	createTemporary: (name?: string | null) =>
		invoke<Project>("create_project_temporary", { name: name ?? null }),

	createFromFolder: (name: string, folder: string) =>
		invoke<Project>("create_project_from_folder", { name, folder }),

	update: (id: string, name: string) =>
		invoke<Project>("update_project", { id, name }),

	delete: (id: string) => invoke<void>("delete_project", { id }),

	getBranch: (folder: string) => invoke<string>("get_git_branch", { folder }),

	getDiff: (contextId: string) =>
		invoke<string>("get_git_diff", { contextId }),
};
