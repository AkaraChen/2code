import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { produce } from "immer";
import { createContext } from "react";
import type { GitCommit } from "@/generated";

export type Tab = "changes" | "history";

export interface GitDiffState {
	activeTab: Tab;
	selectedCommit: GitCommit | null;
	selectedFileIndex: number;
	selectedCommitIndex: number;
	selectedCommitFileIndex: number;
}

type GitDiffAction =
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
		switch (action.type) {
			case "switchTab":
				draft.activeTab = action.tab;
				draft.selectedCommit = null;
				draft.selectedFileIndex = 0;
				draft.selectedCommitIndex = 0;
				draft.selectedCommitFileIndex = 0;
				break;
			case "selectFile":
				draft.selectedFileIndex = action.index;
				break;
			case "selectCommit":
				draft.selectedCommit = action.commit;
				draft.selectedCommitIndex = action.index;
				draft.selectedCommitFileIndex = 0;
				break;
			case "selectCommitFile":
				draft.selectedCommitFileIndex = action.index;
				break;
			case "commitBack":
				draft.selectedCommit = null;
				draft.selectedCommitFileIndex = 0;
				break;
			case "stepIndex": {
				const key = stepKeyMap[action.target];
				draft[key] = clamp(
					draft[key] + action.delta,
					0,
					action.count - 1,
				);
				break;
			}
		}
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
