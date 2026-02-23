import { parsePatchFiles } from "@pierre/diffs";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	getCommitDiff,
	getGitDiff,
	getGitLog,
	getGithubPrStatus,
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

export function useGithubPrStatus(folder: string) {
	return useQuery({
		queryKey: queryKeys.git.githubPrStatus(folder),
		queryFn: () => getGithubPrStatus({ folder }),
		enabled: folder.length > 0,
		refetchOnWindowFocus: true,
		refetchInterval: 60_000,
	});
}

function useCommitDiff(profileId: string, commitHash: string) {
	return useSuspenseQuery({
		queryKey: queryKeys.git.commitDiff(profileId, commitHash),
		queryFn: () => getCommitDiff({ profileId, commitHash }),
	});
}

export function useGitDiffStats(profileId: string) {
	const { data: diff } = useQuery({
		queryKey: queryKeys.git.diff(profileId),
		queryFn: () => getGitDiff({ profileId }),
	});
	return useMemo(() => {
		if (!diff) return null;
		let additions = 0;
		let deletions = 0;
		for (const line of diff.split("\n")) {
			if (line.startsWith("+") && !line.startsWith("+++")) additions++;
			else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
		}
		if (additions === 0 && deletions === 0) return null;
		return { additions, deletions };
	}, [diff]);
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
