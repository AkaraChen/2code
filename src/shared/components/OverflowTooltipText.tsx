import { Portal, Text, Tooltip } from "@chakra-ui/react";
import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { useCallback, useMemo, useRef, useState } from "react";

interface MeasuredTextSnapshot {
	availableWidth: number;
	font: string;
}

export interface OverflowTooltipTextProps {
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

function buildCanvasFont(style: CSSStyleDeclaration) {
	if (style.font.trim().length > 0) {
		return style.font;
	}
	return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

export default function OverflowTooltipText({
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
	const observerRef = useRef<ResizeObserver | null>(null);
	const [snapshot, setSnapshot] = useState<MeasuredTextSnapshot>({
		availableWidth: 0,
		font: "",
	});
	const textRef = useCallback((element: HTMLParagraphElement | null) => {
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
