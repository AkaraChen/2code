import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface MeasuredTextSnapshot {
	availableWidth: number;
	font: string;
}

const TOOLTIP_POSITIONING = { side: "top", align: "start" } as const;

interface OverflowTooltipTextProps {
	displayValue: string;
	tooltipValue: string;
	className?: string;
	tooltipClassName?: string;
	/** Suppress the tooltip entirely, keeping only the truncated text. */
	tooltipDisabled?: boolean;
}

function buildCanvasFont(style: CSSStyleDeclaration) {
	if (style.font.trim().length > 0) {
		return style.font;
	}
	return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

function OverflowTooltipText({
	displayValue,
	tooltipValue,
	className,
	tooltipClassName,
	tooltipDisabled = false,
}: OverflowTooltipTextProps) {
	const observerRef = useRef<ResizeObserver | null>(null);
	const [snapshot, setSnapshot] = useState<MeasuredTextSnapshot>({
		availableWidth: 0,
		font: "",
	});
	const textRef = useCallback((element: HTMLSpanElement | null) => {
		observerRef.current?.disconnect();
		observerRef.current = null;

		if (!element) {
			return;
		}

		const updateSnapshot = () => {
			const nextSnapshot = {
				availableWidth: element.clientWidth,
				font: buildCanvasFont(getComputedStyle(element)),
			};
			setSnapshot((prev) =>
				prev.availableWidth === nextSnapshot.availableWidth &&
				prev.font === nextSnapshot.font
					? prev
					: nextSnapshot,
			);
		};

		updateSnapshot();

		if (typeof ResizeObserver === "undefined") {
			return;
		}

		const observer = new ResizeObserver(updateSnapshot);
		observer.observe(element);
		observerRef.current = observer;
	}, []);
	const naturalWidth = useMemo(() => {
		if (!snapshot.font) {
			return 0;
		}
		return measureNaturalWidth(
			prepareWithSegments(displayValue, snapshot.font),
		);
	}, [displayValue, snapshot.font]);
	const isOverflowing =
		snapshot.availableWidth > 0 && naturalWidth - snapshot.availableWidth > 0.5;

	return (
		<Tooltip
			disabled={tooltipDisabled || !isOverflowing}
		>
			<TooltipTrigger
				render={(
					<span
						ref={textRef}
						className={cn("min-w-0 truncate", className)}
					/>
				)}
			>
				{displayValue}
			</TooltipTrigger>
			<TooltipContent
				align={TOOLTIP_POSITIONING.align}
				side={TOOLTIP_POSITIONING.side}
				className={cn("max-w-[min(480px,calc(100vw-32px))] break-all whitespace-normal", tooltipClassName)}
			>
				{tooltipValue}
			</TooltipContent>
		</Tooltip>
	);
}

export default memo(OverflowTooltipText);
