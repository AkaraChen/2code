import { Box, CloseButton, HStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent, ReactNode } from "react";
import { collectVisibleTabItems } from "./tabStripItems";

const TAB_MIN_WIDTH = "140px";

export interface TabStripItem {
	key: string;
	value: string;
	icon: ReactNode;
	title: string;
	maxTitleLength: number;
	badge?: ReactNode;
	isSelected?: boolean;
	onClose?: () => void;
}

export interface TabStripGroup {
	id: string;
	items: TabStripItem[];
}

interface TabButtonProps extends Omit<TabStripItem, "key"> {
	onSelect: (value: string) => void;
}

function TabButton({
	value,
	icon,
	title,
	maxTitleLength,
	badge,
	isSelected,
	onClose,
	onSelect,
}: TabButtonProps) {
	const displayTitle = title.length > maxTitleLength
		? `${title.slice(0, maxTitleLength)}...`
		: title;

	function selectTab() {
		onSelect(value);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		selectTab();
	}

	return (
		<Box
			as="div"
			role="tab"
			aria-selected={isSelected}
			tabIndex={isSelected ? 0 : -1}
			flexShrink={0}
			minW={TAB_MIN_WIDTH}
			display="flex"
			alignItems="center"
			gap="2"
			py="1"
			px="3"
			textStyle="sm"
			fontWeight="medium"
			bg="transparent"
			color={isSelected ? "fg" : "fg.muted"}
			borderTopWidth="2px"
			borderTopColor={isSelected ? "fg" : "transparent"}
			borderEndWidth="1px"
			borderEndColor="border"
			userSelect="none"
			transition="background-color 120ms ease, color 120ms ease"
			css={{
				WebkitUserDrag: "none",
				"&::before": {
					display: "none",
				},
				"& *": {
					WebkitUserDrag: "none",
				},
			}}
			_hover={{ bg: "bg.subtle", color: "fg" }}
			_active={{ bg: "bg.muted", color: "fg" }}
			_focusVisible={{
				outline: "2px solid",
				outlineColor: "colorPalette.focusRing",
				outlineOffset: "-2px",
			}}
			draggable={false}
			onClick={selectTab}
			onKeyDown={handleKeyDown}
		>
			{icon}
			<HStack gap="2" flex="1" minW="0">
				<Box as="span" minW="0" flex="1" flexShrink={1}>
					{displayTitle}
				</Box>
				{badge}
				{onClose ? (
					<CloseButton
						as="span"
						role="button"
						size="2xs"
						flexShrink={0}
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
					/>
				) : null}
			</HStack>
		</Box>
	);
}

function TabMotionItem({
	item,
	motionProps,
	onSelect,
}: {
	item: TabStripItem;
	motionProps: Record<string, unknown>;
	onSelect: (value: string) => void;
}) {
	return (
		<motion.div
			style={{
				display: "flex",
				flexShrink: 0,
				overflow: "hidden",
				transformOrigin: "left center",
			}}
			{...motionProps}
		>
			<Box display="flex" flexShrink={0} minW="0">
				<TabButton
					value={item.value}
					icon={item.icon}
					title={item.title}
					maxTitleLength={item.maxTitleLength}
					badge={item.badge}
					isSelected={item.isSelected}
					onClose={item.onClose}
					onSelect={onSelect}
				/>
			</Box>
		</motion.div>
	);
}

export function TabStrip({
	groups,
	motionProps,
	onSelect,
	trailingControls,
}: {
	groups: TabStripGroup[];
	motionProps: Record<string, unknown>;
	onSelect: (value: string) => void;
	trailingControls?: ReactNode;
}) {
	const visibleItems = collectVisibleTabItems(groups);

	return (
		<Box
			role="tablist"
			aria-orientation="horizontal"
			display="flex"
			w="full"
			minW="max-content"
		>
			<AnimatePresence initial={false}>
				{visibleItems.map((item) => (
					<TabMotionItem
						key={item.key}
						item={item}
						motionProps={motionProps}
						onSelect={onSelect}
					/>
				))}
			</AnimatePresence>
			{trailingControls}
		</Box>
	);
}
