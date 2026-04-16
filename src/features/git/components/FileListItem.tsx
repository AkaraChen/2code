import { Badge, Checkbox, HStack } from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import OverflowTooltipText from "@/shared/components/OverflowTooltipText";
import { changeBadge } from "../utils";

export interface FileListItemProps {
	file: FileDiffMetadata;
	isActive: boolean;
	isIncluded?: boolean;
	onClick: () => void;
	onToggleIncluded?: (included: boolean) => void;
}

export function FileListItem({
	file,
	isActive,
	isIncluded,
	onClick,
	onToggleIncluded,
}: FileListItemProps) {
	const badge = changeBadge[file.type] ?? changeBadge.change;
	const basename = file.name.split("/").pop() ?? file.name;
	const effectiveIncluded = isIncluded ?? true;
	const parentPath = file.name.includes("/")
		? file.name.split("/").slice(0, -1).join("/")
		: null;

	return (
		<HStack
			px="3"
			py="2"
			cursor="pointer"
			bg={isActive ? "bg.emphasized" : "transparent"}
			_hover={{ bg: isActive ? "bg.emphasized" : "bg.subtle" }}
			onClick={onClick}
			gap="2"
			userSelect="none"
			opacity={effectiveIncluded ? 1 : 0.72}
			align="flex-start"
			w="full"
			minW="0"
			overflow="hidden"
		>
			{onToggleIncluded ? (
				<Checkbox.Root
					mt="0.5"
					size="sm"
					checked={effectiveIncluded}
					onClick={(event) => event.stopPropagation()}
					onCheckedChange={(event) =>
						onToggleIncluded(!!event.checked)
					}
				>
					<Checkbox.HiddenInput />
					<Checkbox.Control />
				</Checkbox.Root>
			) : null}

			<HStack flex="1" gap="2" minW="0" overflow="hidden">
				<OverflowTooltipText
					displayValue={basename}
					tooltipValue={file.name}
					fontSize="sm"
					fontWeight={isActive ? "medium" : "normal"}
					flex="1 1 auto"
					minW="0"
				/>
				{parentPath && (
					<OverflowTooltipText
						displayValue={parentPath}
						tooltipValue={file.name}
						fontSize="xs"
						color="fg.muted"
						flex="0 10 auto"
						minW="2ch"
					/>
				)}
				<Badge
					size="xs"
					colorPalette={badge.colorPalette}
					variant="subtle"
					marginStart="auto"
					flexShrink={0}
				>
					{badge.label}
				</Badge>
			</HStack>
		</HStack>
	);
}
