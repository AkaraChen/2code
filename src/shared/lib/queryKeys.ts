export const queryNamespaces = {
	project: "project",
	"project-config": "project-config",
	"git-branch": "git-branch",
	"git-diff": "git-diff",
	"git-diff-stats": "git-diff-stats",
	"git-status": "git-status",
	"git-index-status": "git-index-status",
	"git-log": "git-log",
	"git-commit-diff": "git-commit-diff",
	"git-binary-preview": "git-binary-preview",
	"git-ahead-count": "git-ahead-count",
	"topbar-apps": "topbar-apps",
	"fs-file": "fs-file",
	"fs-search": "fs-search",
	"fs-tree": "fs-tree",
};

export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	projectConfig: (projectId: string) =>
		["project-config", projectId] as const,
	topbar: {
		apps: ["topbar-apps"] as const,
	},
	git: {
		branch: (folder: string) => ["git-branch", folder] as const,
		diff: (profileId: string) => ["git-diff", profileId] as const,
		diffStats: (profileId: string) =>
			["git-diff-stats", profileId] as const,
		status: (profileId: string) => ["git-status", profileId] as const,
		indexStatus: (profileId: string) =>
			["git-index-status", profileId] as const,
		log: (profileId: string) => ["git-log", profileId] as const,
		commitDiff: (profileId: string, hash: string) =>
			["git-commit-diff", profileId, hash] as const,
		binaryPreview: (
			profileId: string,
			path: string,
			source: string,
			commitHash?: string,
			revision?: string,
		) =>
			[
				"git-binary-preview",
				profileId,
				path,
				source,
				commitHash ?? null,
				revision ?? null,
			] as const,
		aheadCount: (profileId: string) =>
			["git-ahead-count", profileId] as const,
	},
	fs: {
		file: (path: string) => ["fs-file", path] as const,
		search: (profileId: string, query: string) =>
			["fs-search", profileId, query] as const,
		tree: (path: string) => ["fs-tree", path] as const,
	},
};
