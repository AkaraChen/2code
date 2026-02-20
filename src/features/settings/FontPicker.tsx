import {
	Checkbox,
	createListCollection,
	Field,
	Portal,
	Select,
} from "@chakra-ui/react";
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
	const fontFamily = useTerminalSettingsStore((s) => s.fontFamily);
	const showAllFonts = useTerminalSettingsStore((s) => s.showAllFonts);
	const setFontFamily = useTerminalSettingsStore((s) => s.setFontFamily);
	const setShowAllFonts = useTerminalSettingsStore((s) => s.setShowAllFonts);

	const visibleFonts = useMemo(
		() => (showAllFonts ? fonts : fonts.filter((f) => f.is_mono)),
		[fonts, showAllFonts],
	);

	const fontCollection = useMemo(
		() =>
			createListCollection({
				items: visibleFonts.map((f) => ({
					value: f.family,
					label: f.family,
				})),
			}),
		[visibleFonts],
	);

	return (
		<>
			<Field.Root>
				<Field.Label>{m.terminalFont()}</Field.Label>
				<Select.Root
					collection={fontCollection}
					value={[fontFamily]}
					onValueChange={(e) => setFontFamily(e.value[0])}
					size="sm"
				>
					<Select.HiddenSelect />
					<Select.Control>
						<Select.Trigger>
							<Select.ValueText />
						</Select.Trigger>
						<Select.IndicatorGroup>
							<Select.Indicator />
						</Select.IndicatorGroup>
					</Select.Control>
					<Portal>
						<Select.Positioner>
							<Select.Content>
								{fontCollection.items.map((item) => (
									<Select.Item item={item} key={item.value}>
										{item.label}
										<Select.ItemIndicator />
									</Select.Item>
								))}
							</Select.Content>
						</Select.Positioner>
					</Portal>
				</Select.Root>
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
