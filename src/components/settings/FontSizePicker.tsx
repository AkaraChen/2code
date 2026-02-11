import { Field, NumberInput } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import { useFontStore } from "@/stores/fontStore";

export function FontSizePicker() {
	const { fontSize, setFontSize } = useFontStore();

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
