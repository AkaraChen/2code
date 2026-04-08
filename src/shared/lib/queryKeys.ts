export const queryNamespaces = {
	project: "project",
	"project-config": "project-config",
	"git-branch": "git-branch",
	"git-diff": "git-diff",
	"git-diff-stats": "git-diff-stats",
	"git-log": "git-log",
	"git-commit-diff": "git-commit-diff",
};

export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	projectConfig: (projectId: string) =>
		["project-config", projectId] as const,
	git: {
		branch: (folder: string) => ["git-branch", folder] as const,
		diff: (profileId: string) => ["git-diff", profileId] as const,
		diffStats: (profileId: string) =>
			["git-diff-stats", profileId] as const,
		log: (profileId: string) => ["git-log", profileId] as const,
		commitDiff: (profileId: string, hash: string) =>
			["git-commit-diff", profileId, hash] as const,
	},
};
