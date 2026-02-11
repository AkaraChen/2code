export const queryKeys = {
	projects: {
		all: ["projects"] as const,
	},
	profiles: {
		byProject: (projectId: string) => ["profiles", projectId] as const,
	},
};
