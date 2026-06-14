import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
	getCachedProjectAvatar,
	setCachedProjectAvatar,
} from "@/features/projects/projectAvatarCache";
import type {
	ProjectConfig,
	ProjectGroup,
	ProjectSidebarLayoutUpdate,
	ProjectWithProfiles,
} from "@/generated";
import {
	assignProjectToGroup,
	createProjectFromFolder,
	createFileTreePath,
	createProjectGroup,
	deleteFileTreePaths,
	deleteProject,
	getFilePreview,
	getFileTreeGitStatus,
	getGitBranch,
	getProjectConfig,
	getProjectGithubAvatar,
	listFileTreeChildPaths,
	listProjectGroups,
	listProjects,
	moveFileTreePaths,
	openPathInDefaultApp,
	readFileContent,
	renameFileTreePath,
	revealPathInFileManager,
	saveProjectConfig,
	searchFile,
	updateProject,
	updateProjectSidebarLayout,
	writeFileContent,
} from "@/generated";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";
import { GIT_LIGHT_REFRESH_INTERVAL_MS } from "@/shared/lib/queryRefresh";

interface UseProjectAvatarOptions {
	enabled?: boolean;
}

export function useProjects() {
	return useSuspenseQuery({
		queryKey: queryKeys.projects.all,
		queryFn: listProjects,
	});
}

export function useProjectGroups() {
	return useSuspenseQuery({
		queryKey: queryKeys.projectGroups.all,
		queryFn: listProjectGroups,
	});
}

export function useGitBranch(folder: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.git.branch(folder),
		queryFn: () => getGitBranch({ folder }),
		enabled,
		staleTime: GIT_LIGHT_REFRESH_INTERVAL_MS,
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
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
		staleTime:
			shouldCacheFallback && cachedAvatar !== null
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
			await queryClient.invalidateQueries({
				queryKey: queryKeys.projects.all,
			});
			const projects = queryClient.getQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
			);
			const createdProject = projects?.find(
				(item) => item.id === project.id,
			);
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

export function useCreateProjectGroup() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (name: string) => createProjectGroup({ name }),
		onSuccess: (group) => {
			queryClient.setQueryData<ProjectGroup[]>(
				queryKeys.projectGroups.all,
				(groups) => {
					if (!groups) return [group];
					if (groups.some((item) => item.id === group.id)) {
						return groups.map((item) =>
							item.id === group.id ? group : item,
						);
					}
					return [...groups, group];
				},
			);
			queryClient.invalidateQueries({
				queryKey: queryKeys.projectGroups.all,
			});
		},
	});
}

export function useAssignProjectToGroup() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			projectId,
			groupId,
		}: {
			projectId: string;
			groupId: string | null;
		}) => assignProjectToGroup({ projectId, groupId }),
		onSuccess: async (project) => {
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) =>
					projects?.map((item) =>
						item.id === project.id
							? { ...item, group_id: project.group_id ?? null }
							: item,
					),
			);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.projects.all,
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.projectGroups.all,
				}),
			]);
		},
	});
}

export function useUpdateProjectSidebarLayout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (updates: ProjectSidebarLayoutUpdate[]) =>
			updateProjectSidebarLayout({ updates }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.projects.all,
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.projectGroups.all,
				}),
			]);
		},
	});
}

export function useProjectConfig(projectId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.projectConfig(projectId),
		queryFn: () => getProjectConfig({ projectId }),
	});
}

export function useProjectConfigQuery(projectId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.projectConfig(projectId),
		queryFn: () => getProjectConfig({ projectId }),
		enabled: !!projectId && enabled,
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
				queryClient.getQueryData<ProjectWithProfiles[]>(
					queryKeys.projects.all,
				) ?? [];
			queryClient.setQueryData<ProjectWithProfiles[]>(
				queryKeys.projects.all,
				(projects) => projects?.filter((project) => project.id !== id),
			);
			await options?.onSuccess?.(id, projectsBeforeDelete);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.projects.all,
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.projectGroups.all,
				}),
			]);
		},
	});
}

export function useFileTreeChildPaths(
	profileId: string,
	parentPath: string | null,
	enabled = true,
) {
	return useQuery({
		queryKey: queryKeys.fs.treeChildren(profileId, parentPath),
		queryFn: () => listFileTreeChildPaths({ profileId, parentPath }),
		enabled: !!profileId && enabled,
		staleTime: 5000,
	});
}

export function useLoadFileTreeChildPaths(profileId: string) {
	const queryClient = useQueryClient();
	return useCallback(
		(parentPath: string) =>
			queryClient.fetchQuery({
				queryKey: queryKeys.fs.treeChildren(profileId, parentPath),
				queryFn: () => listFileTreeChildPaths({ profileId, parentPath }),
				staleTime: 5000,
			}),
		[queryClient, profileId],
	);
}

export function useFileTreeGitStatus(profileId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.git.status(profileId),
		queryFn: () => getFileTreeGitStatus({ profileId }),
		enabled: !!profileId && enabled,
		staleTime: GIT_LIGHT_REFRESH_INTERVAL_MS,
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
}

export function useRenameFileTreePath(profileId: string) {
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
				profileId,
				sourcePath,
				destinationPath,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(profileId),
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

export function useMoveFileTreePaths(profileId: string) {
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
				profileId,
				sourcePaths,
				targetDirPath,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(profileId),
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

export function useDeleteFileTreePaths(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ paths }: { paths: string[] }) =>
			deleteFileTreePaths({
				profileId,
				paths,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(profileId),
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

export function useCreateFileTreePath(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			path,
			kind,
		}: {
			path: string;
			kind: "file" | "directory";
		}) =>
			createFileTreePath({
				profileId,
				path,
				kind,
			}),
		onSettled: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.tree(profileId),
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

export function useRevealPathInFileManager() {
	return useMutation({
		mutationFn: ({ profileId, path }: { profileId: string; path: string }) =>
			revealPathInFileManager({ profileId, path }),
	});
}

export function useOpenPathInDefaultApp() {
	return useMutation({
		mutationFn: ({ profileId, path }: { profileId: string; path: string }) =>
			openPathInDefaultApp({ profileId, path }),
	});
}

export function useFileContent(profileId: string, path: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.fs.file(profileId, path),
		queryFn: () => readFileContent({ profileId, path }),
		enabled: !!profileId && !!path && enabled,
		staleTime: 10000,
	});
}

export function useFilePreview(profileId: string, path: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.fs.filePreview(profileId, path),
		queryFn: () => getFilePreview({ profileId, path }),
		enabled: !!profileId && !!path && enabled,
		staleTime: 60000,
	});
}

export function useSaveFileContent(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ path, content }: { path: string; content: string }) =>
			writeFileContent({ profileId, path, content }),
		onSuccess: async (_result, { path, content }) => {
			queryClient.setQueryData(queryKeys.fs.file(profileId, path), content);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.fs.file(profileId, path),
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
