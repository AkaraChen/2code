import { Checkbox, Field, NativeSelect } from "@chakra-ui/react";
import { use, useMemo } from "react";
import { fontsApi, type SystemFont } from "@/api/fonts";
import { createCachedPromise } from "@/lib/cachedPromise";
import * as m from "@/paraglide/messages.js";
import { useFontStore } from "@/stores/fontStore";

const getFontsPromise = createCachedPromise<SystemFont[]>(() =>
	fontsApi.listSystemFonts(),
);

export function FontPicker() {
	const fonts = use(getFontsPromise());
	const { fontFamily, showAllFonts, setFontFamily, setShowAllFonts } =
		useFontStore();

	const visibleFonts = useMemo(
		() => (showAllFonts ? fonts : fonts.filter((f) => f.is_mono)),
		[fonts, showAllFonts],
	);

	return (
		<>
			<Field.Root>
				<Field.Label>{m.terminalFont()}</Field.Label>
				<NativeSelect.Root>
					<NativeSelect.Field
						value={fontFamily}
						onChange={(e) => setFontFamily(e.target.value)}
					>
						{visibleFonts.map((f) => (
							<option key={f.family} value={f.family}>
								{f.family}
							</option>
						))}
					</NativeSelect.Field>
					<NativeSelect.Indicator />
				</NativeSelect.Root>
			</Field.Root>
			<Checkbox.Root
				size="sm"
				checked={showAllFonts}
				onCheckedChange={(e) => setShowAllFonts(!!e.checked)}
			>
				<Checkbox.HiddenInput />
				<Checkbox.Control />
				<Checkbox.Label>{m.showAllFonts()}</Checkbox.Label>
			</Checkbox.Root>
		</>
	);
}
