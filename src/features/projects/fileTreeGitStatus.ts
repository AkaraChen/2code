import type { GitStatusEntry } from "@pierre/trees";

const FILE_TREE_GIT_STATUSES = new Set<GitStatusEntry["status"]>([
	"added",
	"deleted",
	"ignored",
	"modified",
	"renamed",
	"untracked",
]);

function isFileTreeGitStatus(
	status: string,
): status is GitStatusEntry["status"] {
	return FILE_TREE_GIT_STATUSES.has(status as GitStatusEntry["status"]);
}

export function toFileTreeGitStatus(
	entries: readonly { path: string; status: string }[] | undefined,
): GitStatusEntry[] {
	if (!entries) return [];

	const gitStatus: GitStatusEntry[] = [];
	for (const entry of entries) {
		if (!entry.path || !isFileTreeGitStatus(entry.status)) continue;
		gitStatus.push({
			path: entry.path,
			status: entry.status,
		});
	}
	return gitStatus;
}
