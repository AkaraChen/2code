import { produce } from "immer";
import { bench, describe } from "vitest";
import type { GitCommit } from "@/generated";
import {
	type GitDiffAction,
	type GitDiffState,
	gitDiffReducer,
	initialState,
} from "./gitDiffReducer";

const mockCommit: GitCommit = {
	hash: "abc1234",
	full_hash: "abc1234567890abcdef",
	author: { name: "Test User", email: "test@test.com" },
	date: "2026-01-01T00:00:00Z",
	message: "test commit",
	files_changed: 3,
	insertions: 10,
	deletions: 5,
};

const immerReducer = produce(
	(draft: GitDiffState, action: GitDiffAction) => {
		switch (action.type) {
			case "switchTab":
				draft.activeTab = action.tab;
				draft.selectedCommit = null;
				draft.selectedFileIndex = 0;
				draft.selectedCommitIndex = 0;
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
				const max = action.count - 1;
				const value =
					action.target === "file"
						? draft.selectedFileIndex
						: action.target === "commit"
							? draft.selectedCommitIndex
							: draft.selectedCommitFileIndex;
				const next = Math.max(0, Math.min(value + action.delta, max));
				if (action.target === "file") {
					draft.selectedFileIndex = next;
				} else if (action.target === "commit") {
					draft.selectedCommitIndex = next;
				} else {
					draft.selectedCommitFileIndex = next;
				}
				break;
			}
		}
	},
);

const actions: GitDiffAction[] = [
	{ type: "switchTab", tab: "history" },
	{ type: "selectCommit", commit: mockCommit, index: 3 },
	{ type: "setCommitFileCount", count: 8 },
	{ type: "stepIndex", target: "commitFile", delta: 1, count: 8 },
	{ type: "stepIndex", target: "commitFile", delta: 1, count: 8 },
	{ type: "commitBack" },
	{ type: "switchTab", tab: "changes" },
	{ type: "stepIndex", target: "file", delta: 1, count: 50 },
	{ type: "stepIndex", target: "file", delta: 1, count: 50 },
	{ type: "setViewMode", viewMode: "split" },
	{ type: "selectFile", index: 12 },
	{ type: "selectCommitFile", index: 2 },
];

function runReducer(
	reducer: (state: GitDiffState, action: GitDiffAction) => GitDiffState,
) {
	let state = initialState;
	for (let index = 0; index < 5_000; index += 1) {
		state = reducer(state, actions[index % actions.length]);
	}
	return state;
}

describe("gitDiffReducer", () => {
	bench("immer reducer", () => {
		runReducer(immerReducer);
	});

	bench("manual reducer", () => {
		runReducer(gitDiffReducer);
	});
});
