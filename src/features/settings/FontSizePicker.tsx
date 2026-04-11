import { Field, NumberInput } from "@chakra-ui/react";
import * as m from "@/paraglide/messages.js";
import {
	MAX_TERMINAL_FONT_SIZE,
	MIN_TERMINAL_FONT_SIZE,
	useTerminalSettingsStore,
} from "./stores/terminalSettingsStore";

export function FontSizePicker() {
	const { fontSize, setFontSize } = useTerminalSettingsStore();

	return (
		<Field.Root>
			<Field.Label>{m.fontSize()}</Field.Label>
			<NumberInput.Root
				min={MIN_TERMINAL_FONT_SIZE}
				max={MAX_TERMINAL_FONT_SIZE}
				value={String(fontSize)}
				onValueChange={(e) => {
					if (e.value === "") return;
					setFontSize(Number(e.value));
				}}
			>
				<NumberInput.Control />
				<NumberInput.Input />
			</NumberInput.Root>
		</Field.Root>
	);
}
