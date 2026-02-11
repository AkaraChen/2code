export const queryKeys = {
	projects: {
		all: ["projects"] as const,
		branch: (folder: string) => ["git-branch", folder] as const,
		diff: (contextId: string) => ["git-diff", contextId] as const,
	},
	profiles: {
		byProject: (projectId: string) => ["profiles", projectId] as const,
	},
};
