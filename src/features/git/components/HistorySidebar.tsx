import { Box, Flex } from "@chakra-ui/react";
import { startTransition, use } from "react";
import * as m from "@/paraglide/messages.js";
import { GitDiffContext } from "../gitDiffReducer";
import CommitFileSidebar from "./CommitFileSidebar";
import CommitList from "./CommitList";

export default function HistorySidebar() {
	const { commits, state, dispatch } = use(GitDiffContext)!;

	if (state.selectedCommit) {
		return (
			<Box
				flex="1"
				display="flex"
				flexDirection="column"
				minH="0"
				overflow="hidden"
			>
				<CommitFileSidebar />
			</Box>
		);
	}

	if (commits.length === 0) {
		return (
			<Flex align="center" justify="center" flex="1" p="8">
				<Box color="fg.muted" fontSize="sm">
					{m.noCommitsFound()}
				</Box>
			</Flex>
		);
	}

	return (
		<CommitList
			commits={commits}
			selectedIndex={state.selectedCommitIndex}
			onCommitSelect={(commit, index) =>
				startTransition(() => {
					dispatch({ type: "selectCommit", commit, index });
				})
			}
		/>
	);
}
