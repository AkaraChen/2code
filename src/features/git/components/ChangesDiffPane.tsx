import { Box } from "@chakra-ui/react";
import { use } from "react";
import { GitDiffContext } from "../gitDiffReducer";
import GitDiffPane from "./GitDiffPane";
import * as m from "@/paraglide/messages.js";

interface ChangesDiffPaneProps {
	visible: boolean;
}

export default function ChangesDiffPane({ visible }: ChangesDiffPaneProps) {
	const { changesFiles, state, options } = use(GitDiffContext)!;
	const activeFile =
		changesFiles.length > 0 && state.selectedFileIndex < changesFiles.length
			? changesFiles[state.selectedFileIndex]
			: null;

	return (
		<Box flex="1" display={visible ? "flex" : "none"}>
			<GitDiffPane
				activeFile={activeFile}
				options={options}
				emptyMessage={
					changesFiles.length === 0
						? m.noChangesDetected()
						: m.selectFileToView()
				}
			/>
		</Box>
	);
}
