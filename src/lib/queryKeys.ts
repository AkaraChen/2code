export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	pty: {
		sessions: (projectId: string) => ["pty-sessions", projectId] as const,
		history: (sessionId: string) => ["pty-history", sessionId] as const,
	},
};
