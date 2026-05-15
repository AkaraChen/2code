import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { createContext } from "react";
import type { GitCommit } from "@/generated";

export type Tab = "changes" | "history";
export type GitDiffViewMode = NonNullable<FileDiffOptions<unknown>["diffStyle"]>;

export interface GitDiffState {
	activeTab: Tab;
	viewMode: GitDiffViewMode;
	selectedCommit: GitCommit | null;
	selectedFileIndex: number;
	selectedCommitIndex: number;
	selectedCommitFileIndex: number;
	commitFileCount: number;
}

export type GitDiffAction =
	| { type: "switchTab"; tab: Tab }
	| { type: "setViewMode"; viewMode: GitDiffViewMode }
	| { type: "selectFile"; index: number }
	| { type: "selectCommit"; commit: GitCommit; index: number }
	| { type: "selectCommitFile"; index: number }
	| { type: "commitBack" }
	| { type: "setCommitFileCount"; count: number }
	| {
			type: "stepIndex";
			target: "file" | "commit" | "commitFile";
			delta: number;
			count: number;
	  };

export const initialState: GitDiffState = {
	activeTab: "changes",
	viewMode: "unified",
	selectedCommit: null,
	selectedFileIndex: 0,
	selectedCommitIndex: 0,
	selectedCommitFileIndex: 0,
	commitFileCount: 0,
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export function gitDiffReducer(
	state: GitDiffState,
	action: GitDiffAction,
): GitDiffState {
	switch (action.type) {
		case "switchTab":
			return {
				...state,
				activeTab: action.tab,
				selectedCommit: null,
				selectedFileIndex: 0,
				selectedCommitIndex: 0,
				selectedCommitFileIndex: 0,
				commitFileCount: 0,
			};
		case "setViewMode":
			return { ...state, viewMode: action.viewMode };
		case "selectFile":
			return { ...state, selectedFileIndex: action.index };
		case "selectCommit":
			return {
				...state,
				selectedCommit: action.commit,
				selectedCommitIndex: action.index,
				selectedCommitFileIndex: 0,
			};
		case "selectCommitFile":
			return { ...state, selectedCommitFileIndex: action.index };
		case "commitBack":
			return {
				...state,
				selectedCommit: null,
				selectedCommitFileIndex: 0,
				commitFileCount: 0,
			};
		case "setCommitFileCount":
			return { ...state, commitFileCount: action.count };
		case "stepIndex":
			return stepIndex(state, action);
	}
}

function stepIndex(
	state: GitDiffState,
	action: Extract<GitDiffAction, { type: "stepIndex" }>,
) {
	const max = action.count - 1;
	switch (action.target) {
		case "file":
			return {
				...state,
				selectedFileIndex: clamp(
					state.selectedFileIndex + action.delta,
					0,
					max,
				),
			};
		case "commit":
			return {
				...state,
				selectedCommitIndex: clamp(
					state.selectedCommitIndex + action.delta,
					0,
					max,
				),
			};
		case "commitFile":
			return {
				...state,
				selectedCommitFileIndex: clamp(
					state.selectedCommitFileIndex + action.delta,
					0,
					max,
				),
			};
	}
}

interface GitDiffContextValue {
	state: GitDiffState;
	dispatch: React.Dispatch<GitDiffAction>;
	profileId: string;
	changesFiles: FileDiffMetadata[];
	commits: GitCommit[];
	options: FileDiffOptions<unknown>;
}

export const GitDiffContext = createContext<GitDiffContextValue | null>(null);
