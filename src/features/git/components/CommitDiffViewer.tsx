import { Box } from "@chakra-ui/react";
import { use } from "react";
import { GitDiffContext } from "../gitDiffReducer";
import { useCommitDiffFiles } from "../hooks";
import GitDiffPane from "./GitDiffPane";
import * as m from "@/paraglide/messages.js";

interface CommitDiffViewerProps {
	visible: boolean;
}

export default function CommitDiffViewer({ visible }: CommitDiffViewerProps) {
	const { profileId, state, options } = use(GitDiffContext)!;
	const commit = state.selectedCommit!;
	const files = useCommitDiffFiles(profileId, commit.full_hash);
	const activeFile =
		files.length > 0 && state.selectedCommitFileIndex < files.length
			? files[state.selectedCommitFileIndex]
			: null;

	return (
		<Box flex="1" display={visible ? "flex" : "none"}>
			<GitDiffPane
				activeFile={activeFile}
				options={options}
				emptyMessage={m.selectFileToView()}
			/>
		</Box>
	);
}
