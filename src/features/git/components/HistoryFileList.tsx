import type { FileDiffMetadata } from "@pierre/diffs";
import { FiArrowLeft } from "react-icons/fi";
import { memo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { GitCommit } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";
import { FileListItem } from "./FileListItem";

interface HistoryFileListProps {
	commit: GitCommit;
	files: FileDiffMetadata[];
	selectedIndex: number;
	onFileSelect: (index: number) => void;
	onBack: () => void;
}

function CommitHeader({
	commit,
	onBack,
}: {
	commit: GitCommit;
	onBack: () => void;
}) {
	return (
		<div className="flex items-center gap-1 px-2 py-1">
			<Button
				size="icon-xs"
				variant="ghost"
				aria-label={m.backToCommitList()}
				onClick={onBack}
			>
				<FiArrowLeft />
			</Button>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="line-clamp-1 text-sm font-medium">
					{commit.message}
				</div>
				<div className="font-mono text-xs text-muted-foreground">
					{commit.hash}
				</div>
			</div>
		</div>
	);
}

interface HistoryFileListRowProps {
	file: FileDiffMetadata;
	index: number;
	isActive: boolean;
	onFileSelect: (index: number) => void;
}

const HistoryFileListRow = memo(({
	file,
	index,
	isActive,
	onFileSelect,
}: HistoryFileListRowProps) => {
	const handleClick = useCallback(() => {
		onFileSelect(index);
	}, [index, onFileSelect]);

	return (
		<div data-index={index}>
			<FileListItem
				file={file}
				isActive={isActive}
				onClick={handleClick}
			/>
		</div>
	);
});

export default function HistoryFileList({
	commit,
	files,
	selectedIndex,
	onFileSelect,
	onBack,
}: HistoryFileListProps) {
	const { ref: listRef } = useScrollIntoView<HTMLDivElement>(selectedIndex);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<CommitHeader commit={commit} onBack={onBack} />
			{files.length === 0 ? (
				<div className="flex flex-1 items-center justify-center p-8">
					<p className="text-sm text-muted-foreground">
						{m.noFileChanges()}
					</p>
				</div>
			) : (
				<>
					<p className="shrink-0 px-3 py-1 text-xs text-muted-foreground">
						{m.changedFiles({ count: files.length })}
					</p>
					<div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
						{files.map((file, i) => (
							<HistoryFileListRow
								key={file.name}
								file={file}
								index={i}
								isActive={selectedIndex === i}
								onFileSelect={onFileSelect}
							/>
						))}
					</div>
				</>
			)}
		</div>
	);
}
