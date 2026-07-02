export const queryNamespaces = {
	project: "project",
	"project-groups": "project-groups",
	"project-avatar": "project-avatar",
	"project-config": "project-config",
	"git-branch": "git-branch",
	"git-diff": "git-diff",
	"git-diff-stats": "git-diff-stats",
	"git-status": "git-status",
	"git-log": "git-log",
	"git-commit-diff": "git-commit-diff",
	"git-binary-preview": "git-binary-preview",
	"git-ahead-count": "git-ahead-count",
	"git-pull-request-status": "git-pull-request-status",
	"profile-delete-check": "profile-delete-check",
	"profile-notes": "profile-notes",
	"topbar-apps": "topbar-apps",
	"browser-apps": "browser-apps",
	"fs-file": "fs-file",
	"fs-file-preview": "fs-file-preview",
	"fs-search": "fs-search",
	"fs-tree": "fs-tree",
} as const;

export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	projectGroups: {
		all: [queryNamespaces["project-groups"]] as const,
	},
	projectAvatar: (projectId: string) =>
		[queryNamespaces["project-avatar"], projectId] as const,
	projectConfig: (projectId: string) =>
		[queryNamespaces["project-config"], projectId] as const,
	topbar: {
		apps: [queryNamespaces["topbar-apps"]] as const,
	},
	browser: {
		installed: [queryNamespaces["browser-apps"]] as const,
	},
	git: {
		branch: (folder: string) =>
			[queryNamespaces["git-branch"], folder] as const,
		diff: (profileId: string) =>
			[queryNamespaces["git-diff"], profileId] as const,
		diffStats: (profileId: string) =>
			[queryNamespaces["git-diff-stats"], profileId] as const,
		status: (profileId: string) =>
			[queryNamespaces["git-status"], profileId] as const,
		log: (profileId: string) =>
			[queryNamespaces["git-log"], profileId] as const,
		commitDiff: (profileId: string, hash: string) =>
			[queryNamespaces["git-commit-diff"], profileId, hash] as const,
		binaryPreview: (
			profileId: string,
			path: string,
			source: string,
			commitHash?: string,
			revision?: string,
		) =>
			[
				queryNamespaces["git-binary-preview"],
				profileId,
				path,
				source,
				commitHash ?? null,
				revision ?? null,
			] as const,
		aheadCount: (profileId: string) =>
			[queryNamespaces["git-ahead-count"], profileId] as const,
		pullRequestStatus: (profileId: string, branchName: string | null) =>
			[
				queryNamespaces["git-pull-request-status"],
				profileId,
				branchName,
			] as const,
	},
	profile: {
		deleteCheck: (profileId: string) =>
			[queryNamespaces["profile-delete-check"], profileId] as const,
		notes: (profileId: string) =>
			[queryNamespaces["profile-notes"], profileId] as const,
	},
	fs: {
		file: (profileId: string, path: string) =>
			[queryNamespaces["fs-file"], profileId, path] as const,
		filePreview: (profileId: string, path: string) =>
			[queryNamespaces["fs-file-preview"], profileId, path] as const,
		search: (profileId: string, query: string) =>
			[queryNamespaces["fs-search"], profileId, query] as const,
		treeChildrenPrefix: (profileId: string) =>
			[queryNamespaces["fs-tree"], profileId] as const,
		treeChildren: (profileId: string, parentPath: string | null) =>
			[queryNamespaces["fs-tree"], profileId, parentPath] as const,
	},
};
