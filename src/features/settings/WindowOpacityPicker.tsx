import { Field, HStack, Slider, Text } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useThemeStore } from "./stores/themeStore";

function readWindowOpacity(value: number | undefined) {
	return value ?? 100;
}

export function WindowOpacityPicker() {
	const windowOpacity = useThemeStore((s) => s.windowOpacity);
	const setWindowOpacity = useThemeStore((s) => s.setWindowOpacity);

	return (
		<Field.Root>
			<HStack justify="space-between" width="100%">
				<Field.Label margin={0}>{m.windowOpacity()}</Field.Label>
				<Text
					fontSize="sm"
					color="fg.muted"
					fontVariantNumeric="tabular-nums"
				>
					{windowOpacity}%
				</Text>
			</HStack>
			<Slider.Root
				size="sm"
				min={0}
				max={100}
				step={1}
				value={[windowOpacity]}
				onValueChange={(e) =>
					setWindowOpacity(readWindowOpacity(e.value[0]))
				}
				width="100%"
			>
				<Slider.Control>
					<Slider.Track>
						<Slider.Range />
					</Slider.Track>
					<Slider.Thumb index={0}>
						<Slider.HiddenInput />
					</Slider.Thumb>
				</Slider.Control>
			</Slider.Root>
		</Field.Root>
	);
}
