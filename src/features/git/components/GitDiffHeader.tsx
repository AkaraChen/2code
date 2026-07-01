import { memo, useCallback, useMemo } from "react";
import { FiGitBranch, FiX } from "react-icons/fi";
import { Button } from "@/components/ui/button";
import {
	DialogClose,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import * as m from "@/paraglide/messages.js";
import type { GitDiffAction, GitDiffViewMode } from "../gitDiffReducer";

interface GitDiffHeaderProps {
	branchName?: string;
	viewMode: GitDiffViewMode;
	dispatch: React.Dispatch<GitDiffAction>;
}

function GitDiffHeader({
	branchName,
	viewMode,
	dispatch,
}: GitDiffHeaderProps) {
	const previewModeItems = useMemo(
		() => [
			{ value: "unified", label: m.gitDiffPreviewModeUnified() },
			{ value: "split", label: m.gitDiffPreviewModeSplit() },
		],
		[],
	);
	const handleViewModeChange = useCallback(
		(value: string[]) => {
			const nextViewMode = value[value.length - 1];
			if (!nextViewMode) return;
			dispatch({
				type: "setViewMode",
				viewMode: nextViewMode as GitDiffViewMode,
			});
		},
		[dispatch],
	);

	return (
		<DialogHeader className="border-b px-4 py-2">
			<div className="flex min-w-0 items-center gap-3">
				<DialogTitle className="min-w-0 flex-1 text-sm">
					<span className="flex min-w-0 items-center gap-1.5">
						<FiGitBranch className="size-4 shrink-0" />
						<span className="truncate">{branchName ?? "main"}</span>
					</span>
				</DialogTitle>

				<div className="shrink-0">
					<ToggleGroup
						aria-label={m.gitDiffPreviewMode()}
						size="sm"
						value={[viewMode]}
						onValueChange={handleViewModeChange}
					>
						{previewModeItems.map((item) => (
							<ToggleGroupItem key={item.value} value={item.value}>
								{item.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</div>

				<DialogClose
					render={(
						<Button
							aria-label="Close"
							variant="ghost"
							size="icon-sm"
							className="shrink-0"
						/>
					)}
				>
					<FiX />
				</DialogClose>
			</div>
		</DialogHeader>
	);
}

export default memo(GitDiffHeader);
