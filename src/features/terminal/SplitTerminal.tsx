import { Box, Flex, IconButton } from "@chakra-ui/react";
import { RiAddLine, RiCloseLine } from "react-icons/ri";
import { useClosePane, useCreatePane } from "@/features/tabs/hooks";
import { useTabStore } from "@/features/tabs/store";
import type { TerminalTab } from "@/features/tabs/types";
import { Terminal } from "./Terminal";

interface SplitTerminalProps {
	profileId: string;
	tab: TerminalTab;
	cwd: string;
}

export function SplitTerminal({ profileId, tab, cwd }: SplitTerminalProps) {
	const { panes, activePaneId } = tab;
	const createPane = useCreatePane();
	const closePane = useClosePane();

	const canSplit = panes.length < 4;
	const canClose = panes.length > 1;

	const handleSplit = () => {
		if (!canSplit) return;
		createPane.mutate({ profileId, tabId: tab.id, cwd });
	};

	const handleClosePane = (paneSessionId: string) => {
		closePane.mutate({ profileId, tabId: tab.id, paneSessionId });
	};

	const handleFocusPane = (paneSessionId: string) => {
		if (paneSessionId !== activePaneId) {
			useTabStore.getState().setActivePane(profileId, tab.id, paneSessionId);
		}
	};

	const handleTitleChange = (paneSessionId: string, title: string) => {
		useTabStore.getState().updatePaneTitle(profileId, tab.id, paneSessionId, title);
	};

	// 1 pane: full screen
	if (panes.length === 1) {
		return (
			<Box w="full" h="full">
				<Pane
					sessionId={panes[0].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[0].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[0].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[0].sessionId, title)}
				/>
			</Box>
		);
	}

	// 2 panes: left | right
	if (panes.length === 2) {
		return (
			<Flex w="full" h="full">
				<Pane
					sessionId={panes[0].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[0].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[0].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[0].sessionId, title)}
				/>
				<PaneDivider orientation="vertical" />
				<Pane
					sessionId={panes[1].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[1].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[1].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[1].sessionId, title)}
				/>
			</Flex>
		);
	}

	// 3 panes: left | center | right
	if (panes.length === 3) {
		return (
			<Flex w="full" h="full">
				<Pane
					sessionId={panes[0].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[0].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[0].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[0].sessionId, title)}
				/>
				<PaneDivider orientation="vertical" />
				<Pane
					sessionId={panes[1].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[1].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[1].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[1].sessionId, title)}
				/>
				<PaneDivider orientation="vertical" />
				<Pane
					sessionId={panes[2].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[2].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[2].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[2].sessionId, title)}
				/>
			</Flex>
		);
	}

	// 4 panes: 2x2 grid
	return (
		<Flex direction="column" w="full" h="full">
			<Flex flex="1" minH="0">
				<Pane
					sessionId={panes[0].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[0].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[0].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[0].sessionId, title)}
				/>
				<PaneDivider orientation="vertical" />
				<Pane
					sessionId={panes[1].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[1].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[1].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[1].sessionId, title)}
				/>
			</Flex>
			<PaneDivider orientation="horizontal" />
			<Flex flex="1" minH="0">
				<Pane
					sessionId={panes[2].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[2].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[2].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[2].sessionId, title)}
				/>
				<PaneDivider orientation="vertical" />
				<Pane
					sessionId={panes[3].sessionId}
					canSplit={canSplit}
					canClose={canClose}
					onFocus={() => handleFocusPane(panes[3].sessionId)}
					onSplit={handleSplit}
					onClose={() => handleClosePane(panes[3].sessionId)}
					onTitleChange={(title) => handleTitleChange(panes[3].sessionId, title)}
				/>
			</Flex>
		</Flex>
	);
}

interface PaneProps {
	sessionId: string;
	canSplit: boolean;
	canClose: boolean;
	onFocus: () => void;
	onSplit: () => void;
	onClose: () => void;
	onTitleChange: (title: string) => void;
}

function Pane({
	sessionId,
	canSplit,
	canClose,
	onFocus,
	onSplit,
	onClose,
	onTitleChange,
}: PaneProps) {
	return (
		<Box
			position="relative"
			flex="1"
			minW="0"
			minH="0"
			onClick={onFocus}
			css={{
				"&:hover .pane-controls": { opacity: 1 },
			}}
			overflow="hidden"
		>
			<Terminal sessionId={sessionId} onTitleChange={onTitleChange} />

			{/* Pane controls overlay — visible on hover */}
			{(canSplit || canClose) && (
				<Flex
					className="pane-controls"
					position="absolute"
					top="1"
					right="1"
					gap="0.5"
					opacity="0"
					transition="opacity 0.15s"
					zIndex="1"
				>
					{canSplit && (
						<IconButton
							aria-label="Split pane"
							size="2xs"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation();
								onSplit();
							}}
						>
							<RiAddLine />
						</IconButton>
					)}
					{canClose && (
						<IconButton
							aria-label="Close pane"
							size="2xs"
							variant="ghost"
							onClick={(e) => {
								e.stopPropagation();
								onClose();
							}}
						>
							<RiCloseLine />
						</IconButton>
					)}
				</Flex>
			)}
		</Box>
	);
}

function PaneDivider({ orientation }: { orientation: "vertical" | "horizontal" }) {
	if (orientation === "vertical") {
		return <Box w="1px" bg="border" flexShrink={0} />;
	}
	return <Box h="1px" bg="border" flexShrink={0} />;
}
