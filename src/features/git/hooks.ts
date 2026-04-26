import { parsePatchFiles } from "@pierre/diffs";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
	commitGitChanges,
	discardGitFileChanges,
	getCommitDiff,
	getGitBinaryPreview,
	getGitAheadCount,
	getGitDiff,
	getGitDiffStats,
	getGitLog,
	gitPush,
} from "@/generated";
import {
	addGitRemote,
	getGitFilePatch,
	getGitIdentity,
	getGitIndexStatus,
	gitInitRepo,
	isGitRepo,
	setGitIdentityCmd,
	stageGitFiles,
	stageGitHunk,
	stageGitLines,
	unsetGitIdentityCmd,
	unstageGitFiles,
	unstageGitHunk,
	unstageGitLines,
	type Identity,
	type IdentityScope,
} from "@/features/git/changesTabBindings";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { GitBinaryPreviewSource } from "./utils";

// Polling is gone: useGitStateSubscription (mounted by the git surface that
// owns these queries) starts a backend file watcher and invalidates the
// queries below when .git/HEAD, .git/refs/, or .git/index change.

function useGitDiff(profileId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.diff(profileId),
		queryFn: () => getGitDiff({ profileId }),
	});
}

export function useGitLog(profileId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.log(profileId),
		queryFn: () => getGitLog({ profileId }),
	});
}

function useCommitDiff(profileId: string, commitHash: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.commitDiff(profileId, commitHash),
		queryFn: () => getCommitDiff({ profileId, commitHash }),
	});
}

export function useGitDiffStats(profileId: string, enabled = true) {
	const { data } = useQuery({
		queryKey: queryKeys.git.diffStats(profileId),
		queryFn: () => getGitDiffStats({ profileId }),
		enabled,
	});

	return useMemo(() => {
		if (!data) return null;
		if (data.insertions === 0 && data.deletions === 0) return null;
		return {
			additions: data.insertions,
			deletions: data.deletions,
			filesChanged: data.files_changed,
		};
	}, [data]);
}

export function useGitAheadCount(profileId: string) {
	const { data } = useQuery({
		queryKey: queryKeys.git.aheadCount(profileId),
		queryFn: () => getGitAheadCount({ profileId }),
	});
	return data ?? 0;
}

export function useGitIndexStatus(profileId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.indexStatus(profileId),
		queryFn: () => getGitIndexStatus({ profileId }),
	});
}

/// Cheap check: is this profile's worktree actually a git repo? Returns
/// false (not undefined) for plain folders so consumers can gate without
/// flicker. Cached aggressively — non-repo state rarely changes.
export function useIsGitRepo(profileId: string) {
	const { data } = useQuery({
		queryKey: ["git-is-repo", profileId] as const,
		queryFn: () => isGitRepo({ profileId }),
		staleTime: 60_000,
	});
	return data ?? false;
}

export function useGitInitRepo(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => gitInitRepo({ profileId }),
		onSuccess: () => {
			// Repo just appeared — refetch the gate query and the index/log
			// queries so the panel re-renders with real content. The branch
			// query keys by folder path (not profile id), so a broad
			// invalidation by namespace covers them.
			queryClient.invalidateQueries({
				queryKey: ["git-is-repo", profileId],
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.git.indexStatus(profileId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.git.log(profileId),
			});
			queryClient.invalidateQueries({
				queryKey: ["git-branch"],
			});
		},
	});
}

export function useAddGitRemote(profileId: string) {
	return useMutation({
		mutationFn: (args: { name: string; url: string }) =>
			addGitRemote({ profileId, ...args }),
	});
}

export function useGitFilePatch(
	profileId: string,
	path: string,
	staged: boolean,
) {
	return useQuery({
		queryKey: ["git-file-patch", profileId, path, staged] as const,
		queryFn: () => getGitFilePatch({ profileId, path, staged }),
	});
}

function useStagingMutation<TArgs>(
	profileId: string,
	mutationFn: (args: TArgs & { profileId: string }) => Promise<void>,
) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: TArgs) => mutationFn({ ...args, profileId }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.indexStatus(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: ["git-file-patch", profileId],
				}),
			]);
		},
	});
}

export function useStageFiles(profileId: string) {
	return useStagingMutation<{ paths: string[] }>(profileId, stageGitFiles);
}

export function useUnstageFiles(profileId: string) {
	return useStagingMutation<{ paths: string[] }>(profileId, unstageGitFiles);
}

export function useStageHunk(profileId: string) {
	return useStagingMutation<{ fileHeader: string; hunks: string[] }>(
		profileId,
		stageGitHunk,
	);
}

export function useUnstageHunk(profileId: string) {
	return useStagingMutation<{ fileHeader: string; hunks: string[] }>(
		profileId,
		unstageGitHunk,
	);
}

export function useStageLines(profileId: string) {
	return useStagingMutation<{
		fileHeader: string;
		hunk: string;
		selectedIndices: number[];
	}>(profileId, stageGitLines);
}

export function useUnstageLines(profileId: string) {
	return useStagingMutation<{
		fileHeader: string;
		hunk: string;
		selectedIndices: number[];
	}>(profileId, unstageGitLines);
}

const gitIdentityKey = (profileId: string) =>
	["git-identity", profileId] as const;

export function useGitIdentity(profileId: string) {
	return useQuery({
		queryKey: gitIdentityKey(profileId),
		queryFn: () => getGitIdentity({ profileId }),
	});
}

export function useSetGitIdentity(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: { identity: Identity; scope: IdentityScope }) =>
			setGitIdentityCmd({ profileId, ...args }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitIdentityKey(profileId) });
		},
	});
}

export function useUnsetGitIdentity(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (args: { scope: IdentityScope }) =>
			unsetGitIdentityCmd({ profileId, ...args }),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: gitIdentityKey(profileId) });
		},
	});
}

export function useGitPush(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => gitPush({ profileId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.git.aheadCount(profileId),
			});
		},
	});
}

export function useCommitGitChanges(profileId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			files,
			message,
			body,
		}: {
			files: string[];
			message: string;
			body?: string;
		}) =>
			commitGitChanges({
				profileId,
				files,
				message,
				body,
			}),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.log(profileId),
				}),
			]);
		},
	});
}

export function useDiscardGitFileChanges(profileId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			paths,
		}: {
			paths: string[];
			filePathsToRefresh?: string[];
		}) => discardGitFileChanges({ profileId, paths }),
		onSuccess: async (_result, variables) => {
			const filePathsToRefresh = variables.filePathsToRefresh ?? [];

			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
				...filePathsToRefresh.map((filePath) =>
					queryClient.invalidateQueries({
						queryKey: queryKeys.fs.file(filePath),
					}),
				),
			]);
		},
	});
}

export function useGitDiffFiles(profileId: string) {
	const { data: diff } = useGitDiff(profileId);
	return useMemo(() => parsePatchFiles(diff).flatMap((p) => p.files), [diff]);
}

export function useCommitDiffFiles(profileId: string, commitHash: string) {
	const { data: commitDiff } = useCommitDiff(profileId, commitHash);
	return useMemo(
		() => parsePatchFiles(commitDiff).flatMap((p) => p.files),
		[commitDiff],
	);
}

interface GitBinaryPreviewRequest {
	profileId: string;
	path: string;
	source: GitBinaryPreviewSource;
	commitHash?: string;
	revision: string;
}

export function useGitBinaryPreview(request: GitBinaryPreviewRequest | null) {
	return useQuery({
		queryKey: request
			? queryKeys.git.binaryPreview(
					request.profileId,
					request.path,
					request.source,
					request.commitHash,
					request.revision,
				)
			: ["git-binary-preview", "idle"],
		queryFn: () => {
			if (!request) {
				return null;
			}

			return getGitBinaryPreview({
				profileId: request.profileId,
				path: request.path,
				source: request.source,
				commitHash: request.commitHash,
			});
		},
		enabled: request != null,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}
