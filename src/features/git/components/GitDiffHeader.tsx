import {
	CloseButton,
	createListCollection,
	Dialog,
	Flex,
	HStack,
	Icon,
	Select,
	Portal,
	Text,
} from "@chakra-ui/react";
import { useMemo } from "react";
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
	const previewModeCollection = useMemo(
		() =>
			createListCollection({
				items: [
					{ value: "unified", label: m.gitDiffPreviewModeUnified() },
					{ value: "split", label: m.gitDiffPreviewModeSplit() },
				],
			}),
		[],
	);

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

				<Flex align="center" gap="2" flexShrink={0}>
					<Text fontSize="xs" color="fg.muted">
						{m.gitDiffPreviewMode()}
					</Text>
					<Select.Root
						collection={previewModeCollection}
						value={[viewMode]}
						onValueChange={(e) => {
							const nextViewMode = e.value[0];
							if (!nextViewMode) return;
							dispatch({
								type: "setViewMode",
								viewMode: nextViewMode as GitDiffViewMode,
							});
						}}
						size="xs"
						width="140px"
						positioning={{ sameWidth: false }}
					>
						<Select.HiddenSelect />
						<Select.Control>
							<Select.Trigger>
								<Select.ValueText />
							</Select.Trigger>
							<Select.IndicatorGroup>
								<Select.Indicator />
							</Select.IndicatorGroup>
						</Select.Control>
						<Portal>
							<Select.Positioner>
								<Select.Content>
									{previewModeCollection.items.map((item) => (
										<Select.Item item={item} key={item.value}>
											{item.label}
											<Select.ItemIndicator />
										</Select.Item>
									))}
								</Select.Content>
							</Select.Positioner>
						</Portal>
					</Select.Root>
				</Flex>

				<Dialog.CloseTrigger asChild>
					<CloseButton size="sm" />
				</Dialog.CloseTrigger>
			</Flex>
		</Dialog.Header>
	);
}
