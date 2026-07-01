import { AnimatePresence, motion } from "motion/react";
import type {
	KeyboardEvent,
	ReactNode,
	RefCallback,
} from "react";
import { RiCloseLine } from "@remixicon/react";

const TAB_MIN_WIDTH = "140px";
export const TAB_STRIP_HEIGHT = "32px";

export interface TabStripItem {
	key: string;
	value: string;
	icon: ReactNode;
	title: string;
	maxTitleLength: number;
	badge?: ReactNode;
	elementRef?: RefCallback<HTMLDivElement>;
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
	elementRef,
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
		<div
			role="tab"
			aria-selected={isSelected}
			tabIndex={isSelected ? 0 : -1}
			className={[
				"flex h-full shrink-0 items-center gap-2 border-r border-t-2 bg-transparent px-3 py-1 text-sm font-medium select-none transition-colors [-webkit-user-drag:none] [&_*]:[-webkit-user-drag:none]",
				"hover:bg-muted active:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]",
				isSelected
					? "border-t-foreground text-foreground"
					: "border-t-transparent text-muted-foreground hover:text-foreground",
			].join(" ")}
			style={{ minWidth: TAB_MIN_WIDTH }}
			draggable={false}
			ref={elementRef}
			onClick={selectTab}
			onKeyDown={handleKeyDown}
		>
			{icon}
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className="min-w-0 flex-1 shrink truncate">
					{displayTitle}
				</span>
				{badge}
				{onClose ? (
					<button
						type="button"
						role="button"
						className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
					>
						<RiCloseLine className="size-3" />
					</button>
				) : null}
			</span>
		</div>
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
				height: "100%",
				overflow: "hidden",
				transformOrigin: "left center",
			}}
			{...motionProps}
		>
			<div className="flex h-full min-w-0 shrink-0">
				<TabButton
					value={item.value}
					icon={item.icon}
					title={item.title}
					maxTitleLength={item.maxTitleLength}
					badge={item.badge}
					elementRef={item.elementRef}
					isSelected={item.isSelected}
					onClose={item.onClose}
					onSelect={onSelect}
				/>
			</div>
		</motion.div>
	);
}

export function TabStrip({
	leadingControl,
	groups,
	motionProps,
	onSelect,
	trailingControls,
}: {
	leadingControl?: ReactNode;
	groups: TabStripGroup[];
	motionProps: Record<string, unknown>;
	onSelect: (value: string) => void;
	trailingControls?: ReactNode;
}) {
	const visibleGroups = groups.filter((group) => group.items.length > 0);

	return (
		<div
			role="tablist"
			aria-orientation="horizontal"
			className="flex w-full min-w-max items-stretch"
			style={{ height: TAB_STRIP_HEIGHT }}
		>
			{leadingControl}
			<AnimatePresence initial={false}>
				{visibleGroups.flatMap((group) =>
					group.items.map((item) => (
						<TabMotionItem
							key={item.key}
							item={item}
							motionProps={motionProps}
							onSelect={onSelect}
						/>
					)),
				)}
			</AnimatePresence>
			{trailingControls}
		</div>
	);
}
