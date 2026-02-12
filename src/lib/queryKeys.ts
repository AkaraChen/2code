export const queryKeys = {
	projects: {
		all: ["projects"] as const,
		branch: (folder: string) => ["git-branch", folder] as const,
		diff: (contextId: string) => ["git-diff", contextId] as const,
		log: (contextId: string) => ["git-log", contextId] as const,
		commitDiff: (contextId: string, hash: string) =>
			["git-commit-diff", contextId, hash] as const,
	},
	profiles: {
		byProject: (projectId: string) => ["profiles", projectId] as const,
	},
};
