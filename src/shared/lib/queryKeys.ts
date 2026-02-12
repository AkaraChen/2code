export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	profiles: {
		byProject: (projectId: string) => ["profiles", projectId] as const,
		all: ["profiles", "all"] as const,
		default: (projectId: string) =>
			["profiles", "default", projectId] as const,
	},
	git: {
		branch: (folder: string) => ["git-branch", folder] as const,
		diff: (profileId: string) => ["git-diff", profileId] as const,
		log: (profileId: string) => ["git-log", profileId] as const,
		commitDiff: (profileId: string, hash: string) =>
			["git-commit-diff", profileId, hash] as const,
	},
};
