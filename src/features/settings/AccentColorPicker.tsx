import { Circle, Field, Flex } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import type { AccentColor } from "./stores/themeStore";
import { ACCENT_COLORS, useSettingsStore } from "./stores";

export function AccentColorPicker() {
	const accentColor = useSettingsStore((s) => s.accentColor);
	const setAccentColor = useSettingsStore((s) => s.setAccentColor);

	return (
		<Field.Root>
			<Field.Label>{m.accentColor()}</Field.Label>
			<Flex gap="2" wrap="wrap">
				{ACCENT_COLORS.map((color) => (
					<Circle
						key={color}
						size="8"
						bg={`${color}.solid`}
						cursor="pointer"
						onClick={() => setAccentColor(color as AccentColor)}
						outline={
							accentColor === color ? "2px solid" : undefined
						}
						outlineColor={
							accentColor === color ? `${color}.fg` : undefined
						}
						outlineOffset="2px"
					/>
				))}
			</Flex>
		</Field.Root>
	);
}
