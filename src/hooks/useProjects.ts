import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";

export function useProjects() {
	return useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: projectsApi.list,
	});
}

export function useGitBranch(folder: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.projects.branch(folder),
		queryFn: () => projectsApi.getBranch(folder),
		staleTime: 30_000,
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
				return projectsApi.createFromFolder(
					opts.name || opts.folder.split("/").pop() || "Untitled",
					opts.folder,
				);
			}
			return projectsApi.createTemporary(opts?.name);
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
			projectsApi.update(id, name),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useDeleteProject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => projectsApi.delete(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
