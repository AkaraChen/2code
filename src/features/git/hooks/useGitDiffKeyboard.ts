import { startTransition } from "react";
import type { GitDiffAction, GitDiffState } from "../gitDiffReducer";
import type { GitCommit } from "@/generated";

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
	return (e: React.KeyboardEvent<HTMLDivElement>) => {
		// 处理上下箭头导航
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const delta = e.key === "ArrowDown" ? 1 : -1;

			if (state.activeTab === "changes") {
				dispatch({
					type: "stepIndex",
					target: "file",
					delta,
					count: changesFilesCount,
				});
			} else if (state.selectedCommit) {
				dispatch({
					type: "stepIndex",
					target: "commitFile",
					delta,
					count:
						sidebarRef.current?.querySelectorAll("[data-index]")
							.length ?? 0,
				});
			} else {
				dispatch({
					type: "stepIndex",
					target: "commit",
					delta,
					count: commits.length,
				});
			}
			return;
		}

		// 处理 Enter 钻入提交
		if (
			e.key === "Enter" &&
			state.activeTab === "history" &&
			!state.selectedCommit
		) {
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
			return;
		}

		// 处理 Backspace/Escape 返回
		if (state.activeTab === "history" && state.selectedCommit) {
			if (e.key === "Backspace") {
				e.preventDefault();
				startTransition(() => {
					dispatch({ type: "commitBack" });
				});
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				startTransition(() => {
					dispatch({ type: "commitBack" });
				});
			}
		}
	};
}
