import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { closeAllTabsForProfiles } from "@/features/tabs/utils";
import {
	createProjectFromFolder,
	createProjectTemporary,
	deleteProject,
	getGitBranch,
	getProjectConfig,
	listProjects,
	saveProjectConfig,
	updateProject,
} from "@/generated";
import type { ProjectConfig } from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

export function useProjects() {
	return useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});
}

export function useGitBranch(folder: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.branch(folder),
		queryFn: () => getGitBranch({ folder }),
	});
}

export function useProject(id: string) {
	const { data: projects } = useProjects();
	return useMemo(() => projects.find((p) => p.id === id), [projects, id]);
}

export function useCreateProject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (opts?: { name?: string; folder?: string }) => {
			if (opts?.folder) {
				return createProjectFromFolder({
					name:
						opts.name || opts.folder.split("/").pop() || "Untitled",
					folder: opts.folder,
				});
			}
			return createProjectTemporary({ name: opts?.name });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useRenameProject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) =>
			updateProject({ id, name }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useProjectConfig(projectId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.projectConfig(projectId),
		queryFn: () => getProjectConfig({ projectId }),
		enabled,
	});
}

export function useSaveProjectConfig() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			projectId,
			config,
		}: {
			projectId: string;
			config: ProjectConfig;
		}) => saveProjectConfig({ projectId, config }),
		onSuccess: (_, { projectId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.projectConfig(projectId),
			});
		},
	});
}

export function useDeleteProject() {
	const queryClient = useQueryClient();
	const { data: projects } = useProjects();

	return useMutation({
		mutationFn: async (id: string) => {
			const project = projects?.find((p) => p.id === id);
			const profileIds = project?.profiles?.map((p) => p.id) ?? [];
			await closeAllTabsForProfiles(profileIds);
			await deleteProject({ id });
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
