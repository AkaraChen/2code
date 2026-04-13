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
	getCommitDiff,
	getGitAheadCount,
	getGitDiff,
	getGitDiffStats,
	getGitLog,
	gitPush,
} from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

const GIT_STATUS_REFRESH_INTERVAL_MS = 1_000;

function useGitDiff(profileId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.diff(profileId),
		queryFn: () => getGitDiff({ profileId }),
		staleTime: 0,
		refetchInterval: GIT_STATUS_REFRESH_INTERVAL_MS,
	});
}

export function useGitLog(profileId: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.log(profileId),
		queryFn: () => getGitLog({ profileId }),
		staleTime: 0,
		refetchInterval: GIT_STATUS_REFRESH_INTERVAL_MS,
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
		staleTime: 0,
		refetchInterval: enabled ? GIT_STATUS_REFRESH_INTERVAL_MS : false,
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
		staleTime: 0,
		refetchInterval: GIT_STATUS_REFRESH_INTERVAL_MS,
	});
	return data ?? 0;
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
