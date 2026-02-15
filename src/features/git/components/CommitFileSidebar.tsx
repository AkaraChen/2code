import { startTransition, use } from "react";
import { GitDiffContext } from "../gitDiffReducer";
import { useCommitDiffFiles } from "../hooks";
import HistoryFileList from "./HistoryFileList";

export default function CommitFileSidebar() {
	const { profileId, state, dispatch } = use(GitDiffContext)!;
	const commit = state.selectedCommit!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);

	return (
		<HistoryFileList
			commit={commit}
			files={files}
			selectedIndex={state.selectedCommitFileIndex}
			onFileSelect={(i) =>
				dispatch({ type: "selectCommitFile", index: i })
			}
			onBack={() =>
				startTransition(() => {
					dispatch({ type: "commitBack" });
				})
			}
		/>
	);
}
