import { memo, useCallback } from "react";
import { FiFileText } from "react-icons/fi";
import { useShallow } from "zustand/react/shallow";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useFileViewerTabsStore } from "@/features/projects/fileViewerTabsStore";
import type { FileSearchResult } from "@/generated";
import * as m from "@/paraglide/messages.js";
import FileTreeFileIcon from "@/shared/components/FileTreeFileIcon";
import { useFileLinkPickerStore } from "./fileLinkPickerStore";

interface CandidateRowProps {
	candidate: FileSearchResult;
	onOpen: (path: string) => void;
}

const CandidateRow = memo(({
	candidate,
	onOpen,
}: CandidateRowProps) => {
	const handleClick = useCallback(() => {
		onOpen(candidate.path);
	}, [candidate.path, onOpen]);

	return (
		<button
			className="flex min-h-11 items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]"
			onClick={handleClick}
		>
			<FileTreeFileIcon fileName={candidate.name} size={16} />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">
					{candidate.name}
				</div>
				<div className="truncate font-mono text-xs text-muted-foreground">
					{candidate.relative_path}
				</div>
			</div>
			<FiFileText aria-hidden="true" className="size-3.5 shrink-0" />
		</button>
	);
});

export function TerminalFileLinkPickerDialog() {
	const { isOpen, profileId, candidates, close } = useFileLinkPickerStore(
		useShallow((state) => ({
			isOpen: state.isOpen,
			profileId: state.profileId,
			candidates: state.candidates,
			close: state.close,
		})),
	);
	const openFile = useFileViewerTabsStore((state) => state.openFile);

	const handleOpen = useCallback((path: string) => {
		if (!profileId) return;
		openFile(profileId, path);
		close();
	}, [close, openFile, profileId]);
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) close();
		},
		[close],
	);

	return (
		<Dialog
			open={isOpen}
			onOpenChange={handleOpenChange}
		>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{m.terminalChooseFilePath()}</DialogTitle>
				</DialogHeader>
				<p className="text-sm text-muted-foreground">
					{m.terminalChooseFilePathDescription()}
				</p>
				<div className="max-h-[50vh] overflow-y-auto rounded-md border">
					{candidates.map((candidate) => (
						<CandidateRow
							key={candidate.path}
							candidate={candidate}
							onOpen={handleOpen}
						/>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
