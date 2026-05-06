import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
	createProjectFromFolder,
	deleteFileTreePaths,
	deleteProject,
	getGitBranch,
	getFileTreeGitStatus,
	getProjectGithubAvatar,
	getProjectConfig,
	listFileTreeChildPaths,
	listFileTreePaths,
	listProjects,
	moveFileTreePaths,
	readFileContent,
	renameFileTreePath,
	saveProjectConfig,
	searchFile,
	updateProject,
	writeFileContent,
} from "@/generated";
import type { ProjectConfig, ProjectWithProfiles } from "@/generated";
import {
	getCachedProjectAvatar,
	setCachedProjectAvatar,
} from "@/features/projects/projectAvatarCache";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";

const GIT_STATUS_REFRESH_INTERVAL_MS = 1_000;
interface UseProjectAvatarOptions {
	enabled?: boolean;
}

export function useProjects() {
	return useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});
}

export function useGitBranch(folder: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.git.branch(folder),
		queryFn: () => getGitBranch({ folder }),
		enabled,
		staleTime: 0,
		refetchInterval: enabled ? GIT_STATUS_REFRESH_INTERVAL_MS : false,
	});
}

export function useProject(id: string) {
	const { data: projects } = useProjects();
	return useMemo(() => projects.find((p) => p.id === id), [projects, id]);
}

export function useProjectAvatar(
	projectId: string,
	options: UseProjectAvatarOptions = {},
) {
	const cachedAvatar = useMemo(
		() => getCachedProjectAvatar(projectId),
		[projectId],
	);
	const shouldCacheFallback = cachedAvatar !== undefined;
	const { enabled = true } = options;

	return useQuery({
		queryKey: queryKeys.projectAvatar(projectId),
		queryFn: async () => {
			const avatarUrl = await getProjectGithubAvatar({ projectId });
			setCachedProjectAvatar(projectId, avatarUrl);
			return avatarUrl;
		},
		enabled,
		initialData: shouldCacheFallback ? cachedAvatar : undefined,
		staleTime: shouldCacheFallback && cachedAvatar !== null
			? Number.POSITIVE_INFINITY
			: 0,
		gcTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
	});
}

export function useProjectProfiles(projectId: string) {
	const { data: projects } = useProjects();
	return useMemo(
		() => projects.find((p) => p.id === projectId)?.profiles ?? [],
		[projects, projectId],
	);
}

export function useCreateProject(options?: {
	onSuccess?: (project: ProjectWithProfiles) => void;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (opts: { name?: string; folder: string }) =>
			createProjectFromFolder({
				name: opts.name || opts.folder.split("/").pop() || "Untitled",
				folder: opts.folder,
			}),
		onSuccess: async (project) => {
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
			const projects = queryClient.getQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
			);
			const createdProject = projects?.find((item) => item.id === project.id);
			if (createdProject) {
				options?.onSuccess?.(createdProject);
			}
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

export function useProjectConfig(projectId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.projectConfig(projectId),
		queryFn: () => getProjectConfig({ projectId }),
	});
}

export function useProjectConfigQuery(projectId: string) {
	return useQuery({
		queryKey: queryKeys.projectConfig(projectId),
		queryFn: () => getProjectConfig({ projectId }),
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
		onSuccess: (_result, { projectId }) => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.projectConfig(projectId),
			});
		},
	});
}

export function useDeleteProject(options?: {
	onSuccess?: (
		deletedProjectId: string,
		projectsBeforeDelete: ProjectWithProfiles[],
	) => void | Promise<void>;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteProject({ id }),
		onSuccess: async (_result, id) => {
			const projectsBeforeDelete =
				queryClient.getQueryData<ProjectWithProfiles[]>(queryKeys.projects.all)
				?? [];
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) => projects?.filter((project) => project.id !== id),
			);
			await options?.onSuccess?.(id, projectsBeforeDelete);
			await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
		},
	});
}

export function useFileTreePaths(path: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.fs.tree(path),
		queryFn: () => listFileTreePaths({ path }),
		enabled: !!path && enabled,
		staleTime: 5000,
	});
}

export function useFileTreeChildPaths(
	rootPath: string,
	parentPath: string | null,
	enabled = true,
) {
	return useQuery({
		queryKey: queryKeys.fs.treeChildren(rootPath, parentPath),
		queryFn: () => listFileTreeChildPaths({ rootPath, parentPath }),
		enabled: !!rootPath && enabled,
		staleTime: 5000,
	});
}

export function useLoadFileTreeChildPaths(rootPath: string) {
	const queryClient = useQueryClient();
	return useCallback(
		(parentPath: string) =>
			queryClient.fetchQuery({
				queryKey: queryKeys.fs.treeChildren(rootPath, parentPath),
				queryFn: () => listFileTreeChildPaths({ rootPath, parentPath }),
				staleTime: 5000,
			}),
		[queryClient, rootPath],
	);
}

export function useFileTreeGitStatus(profileId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.git.status(profileId),
		queryFn: () => getFileTreeGitStatus({ profileId }),
		enabled: !!profileId && enabled,
		staleTime: 0,
		refetchInterval: enabled ? GIT_STATUS_REFRESH_INTERVAL_MS : false,
	});
}

export function useRenameFileTreePath(rootPath: string, profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			sourcePath,
			destinationPath,
		}: {
			sourcePath: string;
			destinationPath: string;
		}) =>
			renameFileTreePath({
				rootPath,
				sourcePath,
				destinationPath,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(rootPath),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
			]);
		},
	});
}

export function useMoveFileTreePaths(rootPath: string, profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			sourcePaths,
			targetDirPath,
		}: {
			sourcePaths: string[];
			targetDirPath: string | null;
		}) =>
			moveFileTreePaths({
				rootPath,
				sourcePaths,
				targetDirPath,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(rootPath),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
			]);
		},
	});
}

export function useDeleteFileTreePaths(rootPath: string, profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ paths }: { paths: string[] }) =>
			deleteFileTreePaths({
				rootPath,
				paths,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(rootPath),
				}),
				queryClient.invalidateQueries({
					queryKey: [queryNamespaces["fs-file"]],
				}),
				queryClient.invalidateQueries({
					queryKey: [queryNamespaces["fs-search"], profileId],
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
			]);
		},
	});
}

export function useFileContent(path: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.fs.file(path),
		queryFn: () => readFileContent({ path }),
		enabled: !!path && enabled,
		staleTime: 10000,
	});
}

export function useSaveFileContent(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ path, content }: { path: string; content: string }) =>
			writeFileContent({ path, content }),
		onSuccess: async (_result, { path, content }) => {
			queryClient.setQueryData(queryKeys.fs.file(path), content);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.fs.file(path) }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
			]);
		},
	});
}

export function useFileSearch(
	profileId: string,
	query: string,
	enabled = true,
) {
	const trimmedQuery = query.trim();
	return useQuery({
		queryKey: queryKeys.fs.search(profileId, trimmedQuery),
		queryFn: () => searchFile({ profileId, query: trimmedQuery }),
		enabled: !!profileId && !!trimmedQuery && enabled,
		placeholderData: (previousData, previousQuery) => {
			if (!trimmedQuery) return undefined;
			const previousProfileId = previousQuery?.queryKey[1];
			return previousProfileId === profileId ? previousData : undefined;
		},
		staleTime: 30000,
	});
}
