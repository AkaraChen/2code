import type { FileDiffOptions } from "@pierre/diffs";
import type { Dispatch } from "react";
import { useCallback, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import {
	AsyncBoundary,
	LoadingError,
	LoadingSpinner,
} from "@/shared/components/Fallbacks";
import GitDiffContent from "./components/GitDiffContent";
import GitDiffHeader from "./components/GitDiffHeader";
import type { GitDiffAction, GitDiffState } from "./gitDiffReducer";

const shikiThemeMap: Record<TerminalThemeId, string> = {
	"github-dark": "github-dark",
	"github-light": "github-light",
	dracula: "dracula",
	"ayu-dark": "ayu-dark",
	"ayu-light": "ayu-light",
	"solarized-dark": "solarized-dark",
	"solarized-light": "solarized-light",
	"one-dark": "one-dark-pro",
	"one-light": "one-light",
};

const professionalDiffOptions = {
	diffIndicators: "bars",
	hunkSeparators: "line-info",
	lineDiffType: "word-alt",
	collapsedContextThreshold: 8,
	expansionLineCount: 24,
	overflow: "scroll",
} as const satisfies Pick<
	FileDiffOptions<unknown>,
	| "diffIndicators"
	| "hunkSeparators"
	| "lineDiffType"
	| "collapsedContextThreshold"
	| "expansionLineCount"
	| "overflow"
>;

interface GitDiffDialogProps {
	isOpen: boolean;
	onClose: () => void;
	profileId: string;
	worktreePath: string;
	branchName?: string;
	state: GitDiffState;
	dispatch: Dispatch<GitDiffAction>;
}

export default function GitDiffDialog({
	isOpen,
	onClose,
	profileId,
	worktreePath,
	branchName,
	state,
	dispatch,
}: GitDiffDialogProps) {
	const termThemeId = useTerminalThemeId();
	const options: FileDiffOptions<unknown> = useMemo(
		() => ({
			theme: shikiThemeMap[termThemeId] ?? "github-dark",
			diffStyle: state.viewMode,
			disableFileHeader: true,
			...professionalDiffOptions,
		}),
		[state.viewMode, termThemeId],
	);
	const handleOpenChange = useCallback(
		(open: boolean) => {
			if (!open) onClose();
		},
		[onClose],
	);

	return (
		<Dialog
			open={isOpen}
			onOpenChange={handleOpenChange}
		>
			<DialogContent
				showCloseButton={false}
				className="flex h-[min(82dvh,56rem)] w-[min(88rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
			>
				<GitDiffHeader
					branchName={branchName}
					viewMode={state.viewMode}
					dispatch={dispatch}
				/>

				<div className="flex min-h-0 flex-1 overflow-hidden">
					<AsyncBoundary
						fallback={<LoadingSpinner />}
						errorFallback={({ error, onRetry }) => (
							<LoadingError error={error} onRetry={onRetry} />
						)}
					>
						<GitDiffContent
							profileId={profileId}
							worktreePath={worktreePath}
							onClose={onClose}
							state={state}
							dispatch={dispatch}
							options={options}
						/>
					</AsyncBoundary>
				</div>
			</DialogContent>
		</Dialog>
	);
}
