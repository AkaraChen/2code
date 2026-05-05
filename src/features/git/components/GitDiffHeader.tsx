import {
	CloseButton,
	Dialog,
	Flex,
	HStack,
	Icon,
	SegmentGroup,
	Text,
} from "@chakra-ui/react";
import { FiGitBranch } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import type { GitDiffAction, GitDiffViewMode } from "../gitDiffReducer";

interface GitDiffHeaderProps {
	branchName?: string;
	viewMode: GitDiffViewMode;
	dispatch: React.Dispatch<GitDiffAction>;
}

export default function GitDiffHeader({
	branchName,
	viewMode,
	dispatch,
}: GitDiffHeaderProps) {
	const previewModeItems = [
		{ value: "unified", label: m.gitDiffPreviewModeUnified() },
		{ value: "split", label: m.gitDiffPreviewModeSplit() },
	];

	return (
		<Dialog.Header py="2" pl="4" pr="16">
			<Flex w="full" align="center" gap="3" minW="0">
				<Dialog.Title fontSize="sm" flex="1" minW="0">
					<HStack gap="1.5" alignItems="center" minW="0">
						<Icon fontSize="md" flexShrink={0}>
							<FiGitBranch />
						</Icon>
						<Text truncate>{branchName ?? "main"}</Text>
					</HStack>
				</Dialog.Title>

				<Flex align="center" flexShrink={0}>
					<SegmentGroup.Root
						aria-label={m.gitDiffPreviewMode()}
						size="xs"
						value={viewMode}
						onValueChange={(e) => {
							const nextViewMode = e.value;
							if (!nextViewMode) return;
							dispatch({
								type: "setViewMode",
								viewMode: nextViewMode as GitDiffViewMode,
							});
						}}
					>
						<SegmentGroup.Indicator />
						<SegmentGroup.Items items={previewModeItems} />
					</SegmentGroup.Root>
				</Flex>

				<Dialog.CloseTrigger asChild>
					<CloseButton size="sm" />
				</Dialog.CloseTrigger>
			</Flex>
		</Dialog.Header>
	);
}
