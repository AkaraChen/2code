import { ChatTextIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react";
import type { FileDiffOptions } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { CSSProperties, ChangeEvent } from "react";
import { memo, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTerminalSettingsStore } from "@/features/settings/stores/terminalSettingsStore";
import * as m from "@/paraglide/messages.js";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import {
	type DiffReviewComment,
	formatReviewCommentsForAgent,
	formatReviewRange,
} from "../reviewQueue";

interface GitReviewQueueDialogProps {
	isOpen: boolean;
	comments: DiffReviewComment[];
	options: FileDiffOptions<unknown>;
	onClose: () => void;
	onClear: () => void;
	onDelete: (id: string) => void;
	onUpdate: (id: string, body: string) => void;
}

interface ReviewQueueCommentCardProps {
	comment: DiffReviewComment;
	fontFamily: string;
	fontSize: number;
	options: FileDiffOptions<unknown>;
	onDelete: (id: string) => void;
	onUpdate: (id: string, body: string) => void;
}

const ReviewQueueCommentCard = memo(({
	comment,
	fontFamily,
	fontSize,
	options,
	onDelete,
	onUpdate,
}: ReviewQueueCommentCardProps) => {
	const diffCss = useMemo(
		() => ({
			"--diffs-font-family": `"${fontFamily}", monospace`,
			"--diffs-font-size": `${fontSize}px`,
		}) as CSSProperties,
		[fontFamily, fontSize],
	);
	const handleDelete = useCallback(() => {
		onDelete(comment.id);
	}, [comment.id, onDelete]);
	const handleBodyChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			onUpdate(comment.id, event.target.value);
		},
		[comment.id, onUpdate],
	);

	return (
		<div className="overflow-hidden rounded-lg border">
			<div className="flex items-start gap-3 border-b bg-muted/50 px-3 py-2.5">
				<div className="min-w-0 flex-1">
					<p className="truncate font-mono text-sm font-semibold">
						{comment.displayName}
					</p>
					<div className="mt-1 flex items-center gap-2">
						<Badge
							variant="outline"
							className="border-blue-500/30 bg-blue-500/10 font-mono text-blue-700 dark:text-blue-400"
						>
							{formatReviewRange(comment.range)}
						</Badge>
						<span className="text-xs text-muted-foreground">
							Selected diff
						</span>
					</div>
				</div>
				<Button
					aria-label="Delete review comment"
					size="icon-xs"
					variant="destructive"
					className="shrink-0"
					onClick={handleDelete}
				>
					<TrashIcon />
				</Button>
			</div>
			<div
				className="mx-3 mt-3 max-h-32 overflow-auto rounded-md border"
				style={diffCss}
			>
				<FileDiff
					fileDiff={comment.fileDiff}
					options={options}
					selectedLines={comment.range}
					disableWorkerPool
				/>
			</div>
			<p className="px-3 pt-3 text-xs font-semibold text-muted-foreground">
				Comment
			</p>
			<Textarea
				className="mx-3 mb-3 mt-1.5 min-h-20 w-[calc(100%-1.5rem)]"
				value={comment.body}
				onChange={handleBodyChange}
			/>
		</div>
	);
});

export default function GitReviewQueueDialog({
	isOpen,
	comments,
	options,
	onClose,
	onClear,
	onDelete,
	onUpdate,
}: GitReviewQueueDialogProps) {
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const fontSize = useTerminalSettingsStore((s) => s.fontSize);
	const reviewDiffOptions = useMemo<FileDiffOptions<unknown>>(
		() => ({
			...options,
			disableFileHeader: true,
			enableGutterUtility: false,
			enableLineSelection: false,
		}),
		[options],
	);
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) onClose();
		},
		[onClose],
	);
	const handleCopyAll = useCallback(async () => {
		await copyTextToClipboard(formatReviewCommentsForAgent(comments));
		toast.success(m.reviewCommentsCopied());
	}, [comments]);
	const handleCopyAndClearAll = useCallback(async () => {
		await copyTextToClipboard(formatReviewCommentsForAgent(comments));
		onClear();
		onClose();
		toast.success(m.reviewCommentsCopiedAndCleared());
	}, [comments, onClear, onClose]);

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent className="flex max-h-[80vh] w-[min(56rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
				<DialogHeader className="border-b p-4">
					<DialogTitle className="flex items-center gap-2">
						<ChatTextIcon className="size-4 shrink-0" />
						{m.reviewQueue()}
					</DialogTitle>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-auto p-4">
					<div className="flex flex-col gap-3">
						{comments.map((comment) => (
							<ReviewQueueCommentCard
								key={comment.id}
								comment={comment}
								fontFamily={fontFamily}
								fontSize={fontSize}
								options={reviewDiffOptions}
								onDelete={onDelete}
								onUpdate={onUpdate}
							/>
						))}
					</div>
				</div>
				<div className="flex justify-end gap-2 border-t bg-muted/50 p-4">
					<Button
						variant="outline"
						onClick={handleCopyAll}
						disabled={comments.length === 0}
					>
						<CopyIcon />
						Copy
					</Button>
					<Button
						variant="destructive"
						onClick={handleCopyAndClearAll}
						disabled={comments.length === 0}
					>
						<CopyIcon />
						Copy and clear all
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
