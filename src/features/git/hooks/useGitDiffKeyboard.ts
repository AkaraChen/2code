import { startTransition, useCallback } from "react";
import { match, P } from "ts-pattern";
import type { GitCommit } from "@/generated";
import type { GitDiffAction, GitDiffState } from "../gitDiffReducer";

interface UseGitDiffKeyboardParams {
	state: GitDiffState;
	dispatch: React.Dispatch<GitDiffAction>;
	changesFilesCount: number;
	commits: GitCommit[];
	sidebarRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * 处理 Git diff 对话框的键盘导航
 * - ↑↓ 在列表中选择项目
 * - Enter 在历史标签中钻入提交
 * - Backspace/Escape 返回到提交列表
 */
export function useGitDiffKeyboard({
	state,
	dispatch,
	changesFilesCount,
	commits,
	sidebarRef,
}: UseGitDiffKeyboardParams) {
	return useCallback(
		(e: React.KeyboardEvent<HTMLDivElement>) => {
			const ctx = {
				key: e.key,
				activeTab: state.activeTab,
				hasCommit: state.selectedCommit !== null,
			};

			match(ctx)
				.with(
					{
						key: P.union("ArrowDown", "ArrowUp"),
						activeTab: "changes",
					},
					({ key }) => {
						e.preventDefault();
						dispatch({
							type: "stepIndex",
							target: "file",
							delta: key === "ArrowDown" ? 1 : -1,
							count: changesFilesCount,
						});
					},
				)
				.with(
					{
						key: P.union("ArrowDown", "ArrowUp"),
						activeTab: "history",
						hasCommit: true,
					},
					({ key }) => {
						e.preventDefault();
						dispatch({
							type: "stepIndex",
							target: "commitFile",
							delta: key === "ArrowDown" ? 1 : -1,
							count:
								sidebarRef.current?.querySelectorAll(
									"[data-index]",
								).length ?? 0,
						});
					},
				)
				.with(
					{
						key: P.union("ArrowDown", "ArrowUp"),
						activeTab: "history",
						hasCommit: false,
					},
					({ key }) => {
						e.preventDefault();
						dispatch({
							type: "stepIndex",
							target: "commit",
							delta: key === "ArrowDown" ? 1 : -1,
							count: commits.length,
						});
					},
				)
				.with(
					{ key: "Enter", activeTab: "history", hasCommit: false },
					() => {
						e.preventDefault();
						if (
							commits.length > 0 &&
							state.selectedCommitIndex < commits.length
						) {
							startTransition(() => {
								dispatch({
									type: "selectCommit",
									commit: commits[state.selectedCommitIndex],
									index: state.selectedCommitIndex,
								});
							});
						}
					},
				)
				.with(
					{ key: "Backspace", activeTab: "history", hasCommit: true },
					() => {
						e.preventDefault();
						startTransition(() => {
							dispatch({ type: "commitBack" });
						});
					},
				)
				.with(
					{ key: "Escape", activeTab: "history", hasCommit: true },
					() => {
						e.preventDefault();
						e.stopPropagation();
						startTransition(() => {
							dispatch({ type: "commitBack" });
						});
					},
				)
				.otherwise(() => {});
		},
		[state, dispatch, changesFilesCount, commits, sidebarRef],
	);
}
