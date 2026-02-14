import { describe, expect, it } from "vitest";
import type { GitCommit } from "@/generated";
import {
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

describe("initialState", () => {
	it("has expected default values", () => {
		expect(initialState).toEqual({
			activeTab: "changes",
			selectedCommit: null,
			selectedFileIndex: 0,
			selectedCommitIndex: 0,
			selectedCommitFileIndex: 0,
			commitFileCount: 0,
		});
	});
});

describe("gitDiffReducer", () => {
	describe("switchTab", () => {
		it("changes activeTab to the specified tab", () => {
			const next = gitDiffReducer(initialState, {
				type: "switchTab",
				tab: "history",
			});
			expect(next.activeTab).toBe("history");
		});

		it("resets selectedCommit to null", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommit: mockCommit,
			};
			const next = gitDiffReducer(state, {
				type: "switchTab",
				tab: "history",
			});
			expect(next.selectedCommit).toBeNull();
		});

		it("resets all indices to 0", () => {
			const state: GitDiffState = {
				...initialState,
				selectedFileIndex: 5,
				selectedCommitIndex: 3,
				selectedCommitFileIndex: 2,
				commitFileCount: 10,
			};
			const next = gitDiffReducer(state, {
				type: "switchTab",
				tab: "changes",
			});
			expect(next.selectedFileIndex).toBe(0);
			expect(next.selectedCommitIndex).toBe(0);
			expect(next.selectedCommitFileIndex).toBe(0);
			expect(next.commitFileCount).toBe(0);
		});

		it("switching to same tab still resets all state", () => {
			const state: GitDiffState = {
				...initialState,
				activeTab: "changes",
				selectedFileIndex: 3,
				selectedCommit: mockCommit,
			};
			const next = gitDiffReducer(state, {
				type: "switchTab",
				tab: "changes",
			});
			expect(next.selectedFileIndex).toBe(0);
			expect(next.selectedCommit).toBeNull();
		});
	});

	describe("selectFile", () => {
		it("sets selectedFileIndex to the given index", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectFile",
				index: 7,
			});
			expect(next.selectedFileIndex).toBe(7);
		});

		it("does not modify other state fields", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommitIndex: 3,
				activeTab: "history",
			};
			const next = gitDiffReducer(state, {
				type: "selectFile",
				index: 2,
			});
			expect(next.selectedCommitIndex).toBe(3);
			expect(next.activeTab).toBe("history");
		});
	});

	describe("selectCommit", () => {
		it("sets selectedCommit to the given commit object", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectCommit",
				commit: mockCommit,
				index: 0,
			});
			expect(next.selectedCommit).toEqual(mockCommit);
		});

		it("sets selectedCommitIndex to the given index", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectCommit",
				commit: mockCommit,
				index: 5,
			});
			expect(next.selectedCommitIndex).toBe(5);
		});

		it("resets selectedCommitFileIndex to 0", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommitFileIndex: 4,
			};
			const next = gitDiffReducer(state, {
				type: "selectCommit",
				commit: mockCommit,
				index: 2,
			});
			expect(next.selectedCommitFileIndex).toBe(0);
		});

		it("preserves selectedFileIndex", () => {
			const state: GitDiffState = {
				...initialState,
				selectedFileIndex: 3,
			};
			const next = gitDiffReducer(state, {
				type: "selectCommit",
				commit: mockCommit,
				index: 0,
			});
			expect(next.selectedFileIndex).toBe(3);
		});
	});

	describe("selectCommitFile", () => {
		it("sets selectedCommitFileIndex to the given index", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectCommitFile",
				index: 3,
			});
			expect(next.selectedCommitFileIndex).toBe(3);
		});

		it("does not modify other state fields", () => {
			const state: GitDiffState = {
				...initialState,
				selectedFileIndex: 1,
				selectedCommitIndex: 2,
			};
			const next = gitDiffReducer(state, {
				type: "selectCommitFile",
				index: 5,
			});
			expect(next.selectedFileIndex).toBe(1);
			expect(next.selectedCommitIndex).toBe(2);
		});
	});

	describe("commitBack", () => {
		it("clears selectedCommit to null", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommit: mockCommit,
			};
			const next = gitDiffReducer(state, { type: "commitBack" });
			expect(next.selectedCommit).toBeNull();
		});

		it("resets selectedCommitFileIndex to 0", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommitFileIndex: 5,
			};
			const next = gitDiffReducer(state, { type: "commitBack" });
			expect(next.selectedCommitFileIndex).toBe(0);
		});

		it("resets commitFileCount to 0", () => {
			const state: GitDiffState = {
				...initialState,
				commitFileCount: 10,
			};
			const next = gitDiffReducer(state, { type: "commitBack" });
			expect(next.commitFileCount).toBe(0);
		});

		it("preserves selectedCommitIndex", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommitIndex: 4,
				selectedCommit: mockCommit,
			};
			const next = gitDiffReducer(state, { type: "commitBack" });
			expect(next.selectedCommitIndex).toBe(4);
		});
	});

	describe("setCommitFileCount", () => {
		it("sets commitFileCount to the given count", () => {
			const next = gitDiffReducer(initialState, {
				type: "setCommitFileCount",
				count: 15,
			});
			expect(next.commitFileCount).toBe(15);
		});
	});

	describe("stepIndex", () => {
		describe("target: file", () => {
			it("increments selectedFileIndex by delta", () => {
				const state: GitDiffState = {
					...initialState,
					selectedFileIndex: 2,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: 1,
					count: 10,
				});
				expect(next.selectedFileIndex).toBe(3);
			});

			it("decrements selectedFileIndex by delta", () => {
				const state: GitDiffState = {
					...initialState,
					selectedFileIndex: 3,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: -1,
					count: 10,
				});
				expect(next.selectedFileIndex).toBe(2);
			});

			it("clamps to 0 when stepping below", () => {
				const state: GitDiffState = {
					...initialState,
					selectedFileIndex: 0,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: -1,
					count: 5,
				});
				expect(next.selectedFileIndex).toBe(0);
			});

			it("clamps to count-1 when stepping above", () => {
				const state: GitDiffState = {
					...initialState,
					selectedFileIndex: 4,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: 1,
					count: 5,
				});
				expect(next.selectedFileIndex).toBe(4);
			});

			it("handles count of 1 (single item)", () => {
				const next = gitDiffReducer(initialState, {
					type: "stepIndex",
					target: "file",
					delta: 1,
					count: 1,
				});
				expect(next.selectedFileIndex).toBe(0);
			});

			it("handles count of 0 (empty list)", () => {
				const next = gitDiffReducer(initialState, {
					type: "stepIndex",
					target: "file",
					delta: 1,
					count: 0,
				});
				// clamp(0+1, 0, -1) = Math.max(0, Math.min(1, -1)) = 0
				expect(next.selectedFileIndex).toBe(0);
			});

			it("handles large delta", () => {
				const state: GitDiffState = {
					...initialState,
					selectedFileIndex: 2,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: 100,
					count: 5,
				});
				expect(next.selectedFileIndex).toBe(4);
			});
		});

		describe("target: commit", () => {
			it("increments selectedCommitIndex by delta", () => {
				const state: GitDiffState = {
					...initialState,
					selectedCommitIndex: 1,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "commit",
					delta: 1,
					count: 5,
				});
				expect(next.selectedCommitIndex).toBe(2);
			});

			it("clamps to bounds", () => {
				const state: GitDiffState = {
					...initialState,
					selectedCommitIndex: 4,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "commit",
					delta: 1,
					count: 5,
				});
				expect(next.selectedCommitIndex).toBe(4);
			});
		});

		describe("target: commitFile", () => {
			it("increments selectedCommitFileIndex by delta", () => {
				const state: GitDiffState = {
					...initialState,
					selectedCommitFileIndex: 0,
				};
				const next = gitDiffReducer(state, {
					type: "stepIndex",
					target: "commitFile",
					delta: 1,
					count: 3,
				});
				expect(next.selectedCommitFileIndex).toBe(1);
			});

			it("clamps to bounds", () => {
				const next = gitDiffReducer(initialState, {
					type: "stepIndex",
					target: "commitFile",
					delta: -1,
					count: 3,
				});
				expect(next.selectedCommitFileIndex).toBe(0);
			});
		});
	});

	describe("stepIndex edge cases", () => {
		it("negative delta with large magnitude clamps to 0", () => {
			const state: GitDiffState = {
				...initialState,
				selectedFileIndex: 3,
			};
			const next = gitDiffReducer(state, {
				type: "stepIndex",
				target: "file",
				delta: -100,
				count: 10,
			});
			expect(next.selectedFileIndex).toBe(0);
		});

		it("delta of 0 does not change index", () => {
			const state: GitDiffState = {
				...initialState,
				selectedFileIndex: 5,
			};
			const next = gitDiffReducer(state, {
				type: "stepIndex",
				target: "file",
				delta: 0,
				count: 10,
			});
			expect(next.selectedFileIndex).toBe(5);
		});

		it("negative count results in clamped 0", () => {
			// clamp(0 + 1, 0, -2) = Math.max(0, Math.min(1, -2)) = 0
			const next = gitDiffReducer(initialState, {
				type: "stepIndex",
				target: "file",
				delta: 1,
				count: -1,
			});
			expect(next.selectedFileIndex).toBe(0);
		});

		it("very large count does not cause issues", () => {
			const state: GitDiffState = {
				...initialState,
				selectedCommitIndex: 5,
			};
			const next = gitDiffReducer(state, {
				type: "stepIndex",
				target: "commit",
				delta: 1,
				count: 999999,
			});
			expect(next.selectedCommitIndex).toBe(6);
		});

		it("step from non-zero index in empty list clamps to 0", () => {
			// Simulates state where index was set before list became empty
			const state: GitDiffState = {
				...initialState,
				selectedFileIndex: 5,
			};
			const next = gitDiffReducer(state, {
				type: "stepIndex",
				target: "file",
				delta: -1,
				count: 0,
			});
			// clamp(5 + (-1), 0, -1) = clamp(4, 0, -1) = Math.max(0, Math.min(4, -1)) = 0
			expect(next.selectedFileIndex).toBe(0);
		});
	});

	describe("action sequences", () => {
		it("switchTab → selectCommit → stepIndex → commitBack → full state integrity", () => {
			let state = initialState;
			state = gitDiffReducer(state, {
				type: "switchTab",
				tab: "history",
			});
			expect(state.activeTab).toBe("history");

			state = gitDiffReducer(state, {
				type: "selectCommit",
				commit: mockCommit,
				index: 2,
			});
			expect(state.selectedCommit).toEqual(mockCommit);
			expect(state.selectedCommitIndex).toBe(2);

			state = gitDiffReducer(state, {
				type: "stepIndex",
				target: "commitFile",
				delta: 1,
				count: 5,
			});
			expect(state.selectedCommitFileIndex).toBe(1);

			state = gitDiffReducer(state, { type: "commitBack" });
			expect(state.selectedCommit).toBeNull();
			expect(state.selectedCommitFileIndex).toBe(0);
			expect(state.commitFileCount).toBe(0);
			// selectedCommitIndex is preserved by commitBack
			expect(state.selectedCommitIndex).toBe(2);
			expect(state.activeTab).toBe("history");
		});

		it("rapid stepIndex increments stay within bounds", () => {
			let state: GitDiffState = { ...initialState };
			for (let i = 0; i < 20; i++) {
				state = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: 1,
					count: 5,
				});
			}
			expect(state.selectedFileIndex).toBe(4);
		});

		it("rapid stepIndex decrements stay within bounds", () => {
			let state: GitDiffState = {
				...initialState,
				selectedFileIndex: 4,
			};
			for (let i = 0; i < 20; i++) {
				state = gitDiffReducer(state, {
					type: "stepIndex",
					target: "file",
					delta: -1,
					count: 5,
				});
			}
			expect(state.selectedFileIndex).toBe(0);
		});
	});

	describe("selectFile edge cases", () => {
		it("accepts negative index (no validation)", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectFile",
				index: -1,
			});
			// The reducer blindly sets the index — no clamping for selectFile
			expect(next.selectedFileIndex).toBe(-1);
		});

		it("accepts very large index (no validation)", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectFile",
				index: 999999,
			});
			expect(next.selectedFileIndex).toBe(999999);
		});
	});

	describe("setCommitFileCount edge cases", () => {
		it("accepts 0", () => {
			const next = gitDiffReducer(initialState, {
				type: "setCommitFileCount",
				count: 0,
			});
			expect(next.commitFileCount).toBe(0);
		});

		it("accepts negative count (no validation)", () => {
			const next = gitDiffReducer(initialState, {
				type: "setCommitFileCount",
				count: -5,
			});
			expect(next.commitFileCount).toBe(-5);
		});
	});

	describe("immutability", () => {
		it("returns a new object reference when state changes", () => {
			const next = gitDiffReducer(initialState, {
				type: "selectFile",
				index: 5,
			});
			expect(next).not.toBe(initialState);
		});

		it("does not mutate the original state", () => {
			const original = { ...initialState };
			gitDiffReducer(initialState, {
				type: "selectFile",
				index: 5,
			});
			expect(initialState).toEqual(original);
		});
	});
});
