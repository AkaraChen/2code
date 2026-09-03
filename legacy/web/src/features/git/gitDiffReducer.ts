import type { FileDiffMetadata, FileDiffOptions } from "@pierre/diffs";
import { produce } from "immer";
import { createContext } from "react";
import type { GitCommit } from "@/generated";

type Tab = "changes" | "history";
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

/** No highlighted commit until the user navigates with arrow keys. */
export const NO_COMMIT_SELECTION = -1;

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
	selectedCommitIndex: NO_COMMIT_SELECTION,
	selectedCommitFileIndex: 0,
	commitFileCount: 0,
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
				draft.selectedCommitIndex = NO_COMMIT_SELECTION;
				draft.selectedCommitFileIndex = 0;
				draft.commitFileCount = 0;
				break;
			case "setViewMode":
				draft.viewMode = action.viewMode;
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
				draft.commitFileCount = 0;
				break;
			case "setCommitFileCount":
				draft.commitFileCount = action.count;
				break;
			case "stepIndex": {
				if (action.count <= 0) break;
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
