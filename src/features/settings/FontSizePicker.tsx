import { Field, NumberInput } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useSettingsStore } from "./stores";

export function FontSizePicker() {
	const { fontSize, setFontSize } = useSettingsStore();

	return (
		<Field.Root>
			<Field.Label>{m.fontSize()}</Field.Label>
			<NumberInput.Root
				min={10}
				max={20}
				value={String(fontSize)}
				onValueChange={(e) => setFontSize(Number(e.value))}
			>
				<NumberInput.Control />
				<NumberInput.Input />
			</NumberInput.Root>
		</Field.Root>
	);
}
