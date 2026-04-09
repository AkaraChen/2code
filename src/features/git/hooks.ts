import { parsePatchFiles } from "@pierre/diffs";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	getCommitDiff,
	getGitDiff,
	getGitDiffStats,
	getGitLog,
} from "@/generated";
import { queryKeys } from "@/shared/lib/queryKeys";

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
		refetchInterval: 5_000,
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
