import { Box } from "@chakra-ui/react";
import { use } from "react";
import { GitDiffContext } from "../gitDiffReducer";
import GitDiffPane from "./GitDiffPane";
import CommitDiffViewer from "./CommitDiffViewer";
import * as m from "@/paraglide/messages.js";

interface HistoryDiffPaneProps {
	visible: boolean;
}

export default function HistoryDiffPane({ visible }: HistoryDiffPaneProps) {
	const { state, options } = use(GitDiffContext)!;

	if (!state.selectedCommit) {
		return (
			<Box flex="1" display={visible ? "flex" : "none"}>
				<GitDiffPane
					activeFile={null}
					options={options}
					emptyMessage={m.selectFileToView()}
				/>
			</Box>
		);
	}

	return <CommitDiffViewer visible={visible} />;
}
