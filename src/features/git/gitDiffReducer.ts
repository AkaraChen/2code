import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { produce } from "immer";
import { createContext } from "react";
import { match } from "ts-pattern";
import type { GitCommit } from "@/generated";

export type Tab = "changes" | "history";

export interface GitDiffState {
	activeTab: Tab;
	selectedCommit: GitCommit | null;
	selectedFileIndex: number;
	selectedCommitIndex: number;
	selectedCommitFileIndex: number;
}

export type GitDiffAction =
	| { type: "switchTab"; tab: Tab }
	| { type: "selectFile"; index: number }
	| { type: "selectCommit"; commit: GitCommit; index: number }
	| { type: "selectCommitFile"; index: number }
	| { type: "commitBack" }
	| {
			type: "stepIndex";
			target: "file" | "commit" | "commitFile";
			delta: number;
			count: number;
	  };

export const initialState: GitDiffState = {
	activeTab: "changes",
	selectedCommit: null,
	selectedFileIndex: 0,
	selectedCommitIndex: 0,
	selectedCommitFileIndex: 0,
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

const stepKeyMap = {
	file: "selectedFileIndex",
	commit: "selectedCommitIndex",
	commitFile: "selectedCommitFileIndex",
} as const;

export const gitDiffReducer = produce(
	(draft: GitDiffState, action: GitDiffAction) => {
		match(action)
			.with({ type: "switchTab" }, ({ tab }) => {
				draft.activeTab = tab;
				draft.selectedCommit = null;
				draft.selectedFileIndex = 0;
				draft.selectedCommitIndex = 0;
				draft.selectedCommitFileIndex = 0;
			})
			.with({ type: "selectFile" }, ({ index }) => {
				draft.selectedFileIndex = index;
			})
			.with({ type: "selectCommit" }, ({ commit, index }) => {
				draft.selectedCommit = commit;
				draft.selectedCommitIndex = index;
				draft.selectedCommitFileIndex = 0;
			})
			.with({ type: "selectCommitFile" }, ({ index }) => {
				draft.selectedCommitFileIndex = index;
			})
			.with({ type: "commitBack" }, () => {
				draft.selectedCommit = null;
				draft.selectedCommitFileIndex = 0;
			})
			.with({ type: "stepIndex" }, ({ target, delta, count }) => {
				const key = stepKeyMap[target];
				draft[key] = clamp(draft[key] + delta, 0, count - 1);
			})
			.exhaustive();
	},
);

interface GitDiffContextValue {
	state: GitDiffState;
	dispatch: React.Dispatch<GitDiffAction>;
	profileId: string;
	changesFiles: FileDiffMetadata[];
	commits: GitCommit[];
	options: FileDiffOptions<unknown>;
}

export const GitDiffContext = createContext<GitDiffContextValue | null>(null);
