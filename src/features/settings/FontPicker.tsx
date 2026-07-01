import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { use, useMemo } from "react";
import type { SystemFont } from "@/generated";
import { listSystemFonts } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { createCachedPromise } from "@/shared/lib/cachedPromise";
import { useTerminalSettingsStore } from "./stores/terminalSettingsStore";

const getFontsPromise = createCachedPromise<SystemFont[]>(() =>
	listSystemFonts(),
);

export function FontPicker() {
	const fonts = use(getFontsPromise());
	const fontFamily = useTerminalSettingsStore((state) => state.fontFamily);
	const showAllFonts = useTerminalSettingsStore(
		(state) => state.showAllFonts,
	);
	const setFontFamily = useTerminalSettingsStore(
		(state) => state.setFontFamily,
	);
	const setShowAllFonts = useTerminalSettingsStore(
		(state) => state.setShowAllFonts,
	);

	const visibleFonts = useMemo(
		() => (showAllFonts ? fonts : fonts.filter((f) => f.is_mono)),
		[fonts, showAllFonts],
	);

	return (
		<>
			<Field>
				<FieldLabel>{m.terminalFont()}</FieldLabel>
				<NativeSelect
					value={fontFamily}
					onChange={(event) => setFontFamily(event.target.value)}
					size="sm"
				>
					{visibleFonts.map((font) => (
						<NativeSelectOption key={font.family} value={font.family}>
							{font.family}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</Field>
			<label className="flex items-center gap-2 text-sm">
				<Checkbox
					checked={showAllFonts}
					onCheckedChange={setShowAllFonts}
				/>
				{m.showAllFonts()}
			</label>
		</>
	);
}
