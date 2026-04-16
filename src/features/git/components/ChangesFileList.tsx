import {
	Badge,
	Box,
	Button,
	Checkbox,
	HStack,
	Portal,
	Text,
	Tooltip,
	VStack,
} from "@chakra-ui/react";
import type { FileDiffMetadata } from "@pierre/diffs";
import { useEffect, useRef, useState } from "react";
import * as m from "@/paraglide/messages.js";
import { useScrollIntoView } from "@/shared/hooks/useScrollIntoView";
import { changeBadge } from "../utils";

interface OverflowTooltipTextProps {
	displayValue: string;
	tooltipValue: string;
	minW?: string;
	maxW?: string;
	flex?: string | number;
	w?: string;
	fontSize: "xs" | "sm";
	fontWeight?: "normal" | "medium";
	color?: string;
}

function OverflowTooltipText({
	displayValue,
	tooltipValue,
	minW,
	maxW,
	flex,
	w,
	fontSize,
	fontWeight,
	color,
}: OverflowTooltipTextProps) {
	const textRef = useRef<HTMLParagraphElement | null>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);

	useEffect(() => {
		const element = textRef.current;
		if (!element) return;

		const updateOverflow = () => {
			setIsOverflowing(element.scrollWidth > element.clientWidth);
		};

		updateOverflow();

		if (typeof ResizeObserver === "undefined") {
			return;
		}

		const observer = new ResizeObserver(() => {
			updateOverflow();
		});
		observer.observe(element);

		return () => observer.disconnect();
	}, [displayValue, fontWeight]);

	return (
		<Tooltip.Root
			disabled={!isOverflowing}
			openDelay={300}
			positioning={{ placement: "top-start" }}
		>
			<Tooltip.Trigger asChild>
				<Text
					ref={textRef}
					fontSize={fontSize}
					fontWeight={fontWeight}
					color={color}
					minW={minW}
					maxW={maxW ?? "full"}
					flex={flex}
					w={w}
					truncate
				>
					{displayValue}
				</Text>
			</Tooltip.Trigger>
			<Portal>
				<Tooltip.Positioner>
					<Tooltip.Content
						maxW="min(480px, calc(100vw - 32px))"
						whiteSpace="normal"
						wordBreak="break-all"
					>
						{tooltipValue}
					</Tooltip.Content>
				</Tooltip.Positioner>
			</Portal>
		</Tooltip.Root>
	);
}

interface FileListItemProps {
	file: FileDiffMetadata;
	isActive: boolean;
	isIncluded?: boolean;
	onClick: () => void;
	onToggleIncluded?: (included: boolean) => void;
}

function FileListItem({
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

			<HStack flex="1" align="center" gap="2" minW="0" overflow="hidden">
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

interface ChangesFileListProps {
	files: FileDiffMetadata[];
	selectedIndex: number;
	includedFileNames: Set<string>;
	onSelect: (index: number) => void;
	onToggleIncluded: (fileName: string, included: boolean) => void;
	onIncludeAll: () => void;
	onIncludeNone: () => void;
}

export default function ChangesFileList({
	files,
	selectedIndex,
	includedFileNames,
	onSelect,
	onToggleIncluded,
	onIncludeAll,
	onIncludeNone,
}: ChangesFileListProps) {
	const { ref: containerRef } =
		useScrollIntoView<HTMLDivElement>(selectedIndex);
	const includedCount = includedFileNames.size;

	return (
		<Box ref={containerRef} flex="1" overflowY="auto" minH="0">
			<HStack
				position="sticky"
				top="0"
				zIndex="1"
				justify="space-between"
				px="3"
				py="2.5"
				bg="bg.subtle"
				borderBottomWidth="1px"
				borderColor="border.subtle"
			>
				<VStack align="start" gap="0">
					<Text fontSize="xs" color="fg.muted">
						{m.changedFiles({ count: files.length })}
					</Text>
				</VStack>
				<HStack gap="1">
					<Button
						size="xs"
						variant="ghost"
						onClick={onIncludeAll}
						disabled={includedCount === files.length}
					>
						{m.gitCommitIncludeAll()}
					</Button>
					<Button
						size="xs"
						variant="ghost"
						onClick={onIncludeNone}
						disabled={includedCount === 0}
					>
						{m.gitCommitIncludeNone()}
					</Button>
				</HStack>
			</HStack>
			{files.map((file, i) => (
				<div key={file.name} data-index={i}>
					<FileListItem
						file={file}
						isActive={selectedIndex === i}
						isIncluded={includedFileNames.has(file.name)}
						onClick={() => onSelect(i)}
						onToggleIncluded={(included) =>
							onToggleIncluded(file.name, included)
						}
					/>
				</div>
			))}
		</Box>
	);
}

export { FileListItem };
