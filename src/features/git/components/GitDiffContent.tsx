import { Box, Flex, Tabs } from "@chakra-ui/react";
import type { FileDiffOptions } from "@pierre/diffs";
import {
	Activity,
	Suspense,
	startTransition,
	useEffect,
	useMemo,
	useReducer,
	useRef,
} from "react";
import { useTerminalThemeId } from "@/features/terminal/hooks";
import type { TerminalThemeId } from "@/features/terminal/themes";
import * as m from "@/paraglide/messages.js";
import { GitDiffContext, gitDiffReducer, initialState } from "../gitDiffReducer";
import { useGitDiffFiles, useGitLog } from "../hooks";
import { useGitDiffKeyboard } from "../hooks/useGitDiffKeyboard";
import ChangesSidebar from "./ChangesSidebar";
import ChangesDiffPane from "./ChangesDiffPane";
import HistorySidebar from "./HistorySidebar";
import HistoryDiffPane from "./HistoryDiffPane";

const shikiThemeMap: Record<TerminalThemeId, string> = {
	"github-dark": "github-dark",
	"github-light": "github-light",
	dracula: "dracula",
	"ayu-dark": "ayu-dark",
	"ayu-light": "ayu-light",
	"solarized-dark": "solarized-dark",
	"solarized-light": "solarized-light",
	"one-dark": "one-dark-pro",
	"one-light": "one-light",
};

interface GitDiffContentProps {
	profileId: string;
}

export default function GitDiffContent({ profileId }: GitDiffContentProps) {
	const termThemeId = useTerminalThemeId();
	const [state, dispatch] = useReducer(gitDiffReducer, initialState);

	const sidebarRef = useRef<HTMLDivElement>(null);

	const changesFiles = useGitDiffFiles(profileId);
	const { data: logData } = useGitLog(profileId);
	const commits = useMemo(() => logData ?? [], [logData]);

	const options: FileDiffOptions<unknown> = useMemo(
		() => ({
			theme: shikiThemeMap[termThemeId] ?? "github-dark",
			diffStyle: "unified",
			diffIndicators: "classic",
			disableFileHeader: true,
			overflow: "wrap",
			expandUnchanged: true,
		}),
		[termThemeId],
	);

	const handleTabChange = (value: string) => {
		startTransition(() => {
			dispatch({
				type: "switchTab",
				tab: value as "changes" | "history",
			});
		});
	};

	const handleKeyDown = useGitDiffKeyboard({
		state,
		dispatch,
		changesFilesCount: changesFiles.length,
		commits,
		sidebarRef,
	});

	// Auto-focus sidebar on tab change (also covers initial dialog open)
	useEffect(() => {
		const timer = setTimeout(() => {
			sidebarRef.current?.focus();
		}, 50);
		return () => clearTimeout(timer);
	}, [state.activeTab]);

	// Re-focus sidebar when returning from commit files to commit list
	useEffect(() => {
		if (!state.selectedCommit) {
			sidebarRef.current?.focus();
		}
	}, [state.selectedCommit]);

	const isChanges = state.activeTab === "changes";

	const ctxValue = useMemo(
		() => ({ state, dispatch, profileId, changesFiles, commits, options }),
		[state, dispatch, profileId, changesFiles, commits, options],
	);

	return (
		<GitDiffContext value={ctxValue}>
			<Flex flex="1" overflow="hidden">
				{/* Sidebar column */}
				<Flex
					ref={sidebarRef}
					direction="column"
					w="320px"
					flexShrink={0}
					overflow="hidden"
					tabIndex={0}
					onKeyDown={handleKeyDown}
					outline="none"
				>
					<Tabs.Root
						value={state.activeTab}
						onValueChange={(e) => handleTabChange(e.value)}
						size="sm"
						variant="subtle"
						flex="1"
						minH="0"
						display="flex"
						flexDirection="column"
					>
						<Tabs.List px="3">
							<Tabs.Trigger value="changes">
								{m.changes()}
							</Tabs.Trigger>
							<Tabs.Trigger value="history">
								{m.history()}
							</Tabs.Trigger>
						</Tabs.List>

						{/* Changes sidebar */}
						<Activity mode={isChanges ? "visible" : "hidden"}>
							<Box
								flex={isChanges ? "1" : undefined}
								display={isChanges ? "flex" : "none"}
								flexDirection="column"
								overflow="hidden"
							>
								<Suspense fallback={null}>
									<ChangesSidebar />
								</Suspense>
							</Box>
						</Activity>

						{/* History sidebar */}
						<Activity mode={!isChanges ? "visible" : "hidden"}>
							<Box
								flex={!isChanges ? "1" : undefined}
								display={!isChanges ? "flex" : "none"}
								flexDirection="column"
								overflow="hidden"
							>
								<Suspense fallback={null}>
									<HistorySidebar />
								</Suspense>
							</Box>
						</Activity>
					</Tabs.Root>
				</Flex>

				{/* Pane column */}
				<Activity mode={isChanges ? "visible" : "hidden"}>
					<Suspense fallback={null}>
						<ChangesDiffPane visible={isChanges} />
					</Suspense>
				</Activity>

				<Activity mode={!isChanges ? "visible" : "hidden"}>
					<Suspense fallback={null}>
						<HistoryDiffPane visible={!isChanges} />
					</Suspense>
				</Activity>
			</Flex>
		</GitDiffContext>
	);
}
