import { Field, SegmentGroup } from "@chakra-ui/react";
import { useThemeStore, type BorderRadius } from "@/stores/themeStore";
import * as m from "@/paraglide/messages.js";

const items: { value: BorderRadius; label: () => string }[] = [
	{ value: "none", label: () => m.radiusNone() },
	{ value: "sm", label: () => m.radiusSmall() },
	{ value: "md", label: () => m.radiusMedium() },
	{ value: "lg", label: () => m.radiusLarge() },
	{ value: "xl", label: () => m.radiusXLarge() },
];

export function BorderRadiusPicker() {
	const borderRadius = useThemeStore((s) => s.borderRadius);
	const setBorderRadius = useThemeStore((s) => s.setBorderRadius);

	return (
		<Field.Root>
			<Field.Label>{m.borderRadius()}</Field.Label>
			<SegmentGroup.Root
				size="sm"
				value={borderRadius}
				onValueChange={(e) => setBorderRadius(e.value as BorderRadius)}
			>
				<SegmentGroup.Indicator />
				<SegmentGroup.Items
					items={items.map((i) => ({
						value: i.value,
						label: i.label(),
					}))}
				/>
			</SegmentGroup.Root>
		</Field.Root>
	);
}
