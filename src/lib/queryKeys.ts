export const queryKeys = {
	projects: {
		all: ["projects"] as const,
		branch: (folder: string) => ["git-branch", folder] as const,
	},
	profiles: {
		byProject: (projectId: string) => ["profiles", projectId] as const,
	},
};
