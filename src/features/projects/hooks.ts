import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
	createProjectFromFolder,
	createProjectTemporary,
	deleteProject,
	getGitBranch,
	listProjects,
	updateProject,
} from "@/generated";
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

export function useProjectProfiles(projectId: string) {
	const { data: projects } = useProjects();
	return useMemo(
		() => projects.find((p) => p.id === projectId)?.profiles ?? [],
		[projects, projectId],
	);
}

export function useDefaultProfile(projectId: string) {
	const profiles = useProjectProfiles(projectId);
	return useMemo(
		() => profiles.find((p) => p.is_default) ?? null,
		[profiles],
	);
}

export function useAllProfiles() {
	const { data: projects } = useProjects();
	return useMemo(() => projects.flatMap((p) => p.profiles), [projects]);
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

export function useDeleteProject() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteProject({ id }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}
