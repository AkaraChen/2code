import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field, FieldLabel } from "@/components/ui/field";
import * as m from "@/paraglide/messages.js";
import type { BorderRadius } from "./stores/themeStore";
import { useThemeStore } from "./stores/themeStore";

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
		<Field>
			<FieldLabel>{m.borderRadius()}</FieldLabel>
			<ToggleGroup
				size="sm"
				value={[borderRadius]}
				onValueChange={(value) => {
					const next = value[value.length - 1];
					if (next) setBorderRadius(next as BorderRadius);
				}}
			>
				{items.map((item) => (
					<ToggleGroupItem key={item.value} value={item.value}>
						{item.label()}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</Field>
	);
}
