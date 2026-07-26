import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import {
	checkoutGitBranch,
	commitGitChanges,
	discardGitFileChanges,
	getCommitDiff,
	getGitBinaryPreview,
	getGitAheadCount,
	getGitDiffStats,
	getGitDiffSnapshot,
	getGitLog,
	getGitPullRequestStatus,
	gitPush,
	listGitBranches,
} from "@/generated";
import type { GitDiffStats } from "@/generated";
import { queryKeys, queryNamespaces } from "@/shared/lib/queryKeys";
import { GIT_LIGHT_REFRESH_INTERVAL_MS } from "@/shared/lib/queryRefresh";
import { parseDiffFiles } from "./patchFiles";
import type { GitBinaryPreviewSource } from "./utils";

const GIT_DIFF_SNAPSHOT_STALE_MS = 30_000;
const GIT_HISTORY_STALE_MS = 60_000;
const PR_STATUS_REFRESH_INTERVAL_MS = 2 * 60 * 1_000;

function useRefreshOnEnable(enabled: boolean, refetch: () => Promise<unknown>) {
	const wasEnabledRef = useRef(enabled);

	useEffect(() => {
		if (!wasEnabledRef.current && enabled) {
			void refetch();
		}
		wasEnabledRef.current = enabled;
	}, [enabled, refetch]);
}

function useGitDiff(profileId: string, isVisible = true) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.diff(profileId),
		queryFn: () => getGitDiffSnapshot({ profileId }),
		select: (snapshot) => snapshot.diff,
		staleTime: GIT_DIFF_SNAPSHOT_STALE_MS,
		refetchInterval: isVisible ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
}

function toGitDiffSummary(data: GitDiffStats | null | undefined) {
	if (!data) return null;
	if (data.insertions === 0 && data.deletions === 0) return null;
	return {
		additions: data.insertions,
		deletions: data.deletions,
		filesChanged: data.files_changed,
	};
}

export function useGitLog(profileId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.git.log(profileId),
		queryFn: () => getGitLog({ profileId }),
		enabled,
		staleTime: GIT_HISTORY_STALE_MS,
		refetchOnMount: "always",
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
}

function useCommitDiff(profileId: string, commitHash: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.commitDiff(profileId, commitHash),
		queryFn: () => getCommitDiff({ profileId, commitHash }),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function useGitDiffStats(profileId: string, enabled = true) {
	const { data, refetch } = useQuery({
		queryKey: queryKeys.git.diffStats(profileId),
		queryFn: () => getGitDiffStats({ profileId }),
		enabled,
		staleTime: GIT_DIFF_SNAPSHOT_STALE_MS,
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
	useRefreshOnEnable(enabled, refetch);

	return useMemo(() => toGitDiffSummary(data), [data]);
}

export function useGitAheadCount(profileId: string, enabled = true) {
	const { data, refetch } = useQuery({
		queryKey: queryKeys.git.aheadCount(profileId),
		queryFn: () => getGitAheadCount({ profileId }),
		enabled,
		staleTime: GIT_LIGHT_REFRESH_INTERVAL_MS,
		refetchInterval: enabled ? GIT_LIGHT_REFRESH_INTERVAL_MS : false,
	});
	useRefreshOnEnable(enabled, refetch);
	return data ?? 0;
}

export function useGitPullRequestStatus(
	profileId: string,
	branchName: string | null | undefined,
	enabled = true,
) {
	return useQuery({
		queryKey: queryKeys.git.pullRequestStatus(profileId, branchName ?? null),
		queryFn: () =>
			getGitPullRequestStatus({
				profileId,
				branchName: branchName ?? null,
			}),
		enabled: !!profileId && !!branchName && enabled,
		staleTime: 30_000,
		refetchInterval: enabled ? PR_STATUS_REFRESH_INTERVAL_MS : false,
		retry: false,
	});
}

export function useGitBranches(profileId: string, enabled = true) {
	return useQuery({
		queryKey: queryKeys.git.branches(profileId),
		queryFn: () => listGitBranches({ profileId }),
		enabled,
		staleTime: 10_000,
		refetchOnMount: "always",
	});
}

export function useCheckoutGitBranch(profileId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ branch }: { branch: string }) =>
			checkoutGitBranch({ profileId, branch }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.branches(profileId),
				}),
				// Branch-name queries key by folder, so invalidate the namespace.
				queryClient.invalidateQueries({
					queryKey: [queryNamespaces["git-branch"]],
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diff(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.diffStats(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.log(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.aheadCount(profileId),
				}),
			]);
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
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.aheadCount(profileId),
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
				queryClient.invalidateQueries({
					queryKey: queryKeys.git.status(profileId),
				}),
				...filePathsToRefresh.map((filePath) =>
					queryClient.invalidateQueries({
						queryKey: queryKeys.fs.file(profileId, filePath),
					}),
				),
			]);
		},
	});
}

export function useGitDiffFiles(profileId: string, isVisible = true) {
	const { data: diff } = useGitDiff(profileId, isVisible);
	return useMemo(() => parseDiffFiles(diff), [diff]);
}

export function useCommitDiffFiles(profileId: string, commitHash: string) {
	const { data: commitDiff } = useCommitDiff(profileId, commitHash);
	return useMemo(() => parseDiffFiles(commitDiff), [commitDiff]);
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
