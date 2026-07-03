import { GitCommitIcon } from "@phosphor-icons/react";
import { memo, useCallback } from "react";
import type { GitCommit } from "@/generated";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";
import { cn } from "@/lib/utils";

function formatRelativeTime(isoDate: string): string {
	const now = Date.now();
	const then = new Date(isoDate).getTime();
	const diffSec = Math.floor((now - then) / 1000);

	if (diffSec < 60) return "just now";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return `${diffDay}d ago`;
	const diffMonth = Math.floor(diffDay / 30);
	if (diffMonth < 12) return `${diffMonth}mo ago`;
	const diffYear = Math.floor(diffMonth / 12);
	return `${diffYear}y ago`;
}

interface CommitListProps {
	commits: GitCommit[];
	selectedIndex: number;
	onCommitSelect: (commit: GitCommit, index: number) => void;
}

interface CommitListRowProps {
	commit: GitCommit;
	index: number;
	isActive: boolean;
	onCommitSelect: (commit: GitCommit, index: number) => void;
}

const CommitListRow = memo(({
	commit,
	index,
	isActive,
	onCommitSelect,
}: CommitListRowProps) => {
	const handleClick = useCallback(() => {
		onCommitSelect(commit, index);
	}, [commit, index, onCommitSelect]);

	return (
		<div
			data-index={index}
			className={cn(
				"flex select-none flex-col gap-0.5 px-3 py-1.5",
				isActive ? "bg-muted" : "hover:bg-muted/70",
			)}
			onClick={handleClick}
		>
			<div className="line-clamp-1 text-sm">
				{commit.message}
			</div>
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<span className="flex items-center gap-1">
					<GitCommitIcon className="size-3" />
					<span className="font-mono">{commit.hash}</span>
				</span>
				<span className="min-w-0 flex-1 truncate">
					{commit.author.name}
				</span>
				<span className="shrink-0">{formatRelativeTime(commit.date)}</span>
			</div>
			<div className="flex items-center gap-2 text-xs">
				{commit.files_changed > 0 && (
					<span className="text-muted-foreground">
						{commit.files_changed}{" "}
						{commit.files_changed === 1 ? "file" : "files"}
					</span>
				)}
				{commit.insertions > 0 && (
					<span className="text-green-600 dark:text-green-400">
						+{commit.insertions}
					</span>
				)}
				{commit.deletions > 0 && (
					<span className="text-red-600 dark:text-red-400">
						-{commit.deletions}
					</span>
				)}
			</div>
		</div>
	);
});

export default function CommitList({
	commits,
	selectedIndex,
	onCommitSelect,
}: CommitListProps) {
	const { ref: containerRef } =
		useScrollIntoView<HTMLDivElement>(selectedIndex);

	return (
		<div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
			{commits.map((commit, index) => (
				<CommitListRow
					key={commit.full_hash}
					commit={commit}
					index={index}
					isActive={selectedIndex === index}
					onCommitSelect={onCommitSelect}
				/>
			))}
		</div>
	);
}
