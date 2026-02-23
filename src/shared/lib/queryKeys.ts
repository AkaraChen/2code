// Using a const object instead of enum because the TS config here
// requires `as const` (isolatedModules / verbatimModuleSyntax).
export const queryNamespaces = {
	projects: "projects",
	"git-branch": "git-branch",
	"git-diff": "git-diff",
	"git-log": "git-log",
	"git-commit-diff": "git-commit-diff",
	"agent-status": "agent-status",
	"agent-credentials": "agent-credentials",
	stats: "stats",
	"project-config": "project-config",
	snippets: "snippets",
	skills: "skills",
	"marketplace-registry": "marketplace-registry",
	"marketplace-agents": "marketplace-agents",
} as const;

export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	git: {
		branch: (folder: string) => ["git-branch", folder] as const,
		diff: (profileId: string) => ["git-diff", profileId] as const,
		log: (profileId: string) => ["git-log", profileId] as const,
		commitDiff: (profileId: string, hash: string) =>
			["git-commit-diff", profileId, hash] as const,
	},
	agent: {
		status: () => ["agent-status"] as const,
		credentials: () => ["agent-credentials"] as const,
	},
	stats: {
		homepage: ["stats", "homepage"] as const,
	},
	snippets: {
		all: ["snippets"] as const,
	},
	skills: {
		all: ["skills"] as const,
	},
	marketplace: {
		registry: ["marketplace-registry"] as const,
		agents: ["marketplace-agents"] as const,
	},
	projectConfig: (projectId: string) =>
		["project-config", projectId] as const,
};
