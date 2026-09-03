import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import * as m from "@/paraglide/messages.js";
import {
	MAX_TERMINAL_FONT_SIZE,
	MIN_TERMINAL_FONT_SIZE,
	useTerminalSettingsStore,
} from "./stores/terminalSettingsStore";

export function FontSizePicker() {
	const fontSize = useTerminalSettingsStore((state) => state.fontSize);
	const setFontSize = useTerminalSettingsStore((state) => state.setFontSize);

	return (
		<Field>
			<FieldLabel>{m.fontSize()}</FieldLabel>
			<Input
				type="number"
				min={MIN_TERMINAL_FONT_SIZE}
				max={MAX_TERMINAL_FONT_SIZE}
				value={String(fontSize)}
				onChange={(event) => {
					if (event.target.value === "") return;
					setFontSize(Number(event.target.value));
				}}
			/>
		</Field>
	);
}
