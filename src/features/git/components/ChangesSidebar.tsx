import { Box, Flex } from "@chakra-ui/react";
import { use } from "react";
import * as m from "@/paraglide/messages.js";
import { GitDiffContext } from "../gitDiffReducer";
import ChangesFileList from "./ChangesFileList";

export default function ChangesSidebar() {
	const { changesFiles, state, dispatch } = use(GitDiffContext)!;

	if (changesFiles.length === 0) {
		return (
			<Flex align="center" justify="center" flex="1" p="8">
				<Box color="fg.muted" fontSize="sm">
					{m.noChangesDetected()}
				</Box>
			</Flex>
		);
	}

	return (
		<Box flex="1" overflowY="auto">
			<ChangesFileList
				files={changesFiles}
				selectedIndex={state.selectedFileIndex}
				onSelect={(i) => dispatch({ type: "selectFile", index: i })}
			/>
		</Box>
	);
}
