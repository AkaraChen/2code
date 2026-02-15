import {
	createListCollection,
	Field,
	Portal,
	Select,
	Stack,
	Switch,
	Text,
} from "@chakra-ui/react";
import { use, useMemo } from "react";
import { useDebugStore } from "@/features/debug/debugStore";
import * as m from "@/paraglide/messages.js";
import type { Locale } from "@/paraglide/runtime.js";
import { getLocale, setLocale } from "@/paraglide/runtime.js";
import { ThemeContext } from "@/shared/providers/themeContext";
import { AccentColorPicker } from "../AccentColorPicker";
import { BorderRadiusPicker } from "../BorderRadiusPicker";

const localeCollection = createListCollection({
	items: [
		{ value: "en", label: "English" },
		{ value: "zh", label: "中文" },
	],
});

/**
 * 通用设置选项卡
 * 语言、主题、强调色、圆角、调试模式
 */
export function GeneralSettings() {
	const { preference, setPreference } = use(ThemeContext);
	const { enabled: debugEnabled, setEnabled: setDebugEnabled } =
		useDebugStore();

	const themeCollection = useMemo(
		() =>
			createListCollection({
				items: [
					{ value: "system", label: m.themeSystem() },
					{ value: "light", label: m.themeLight() },
					{ value: "dark", label: m.themeDark() },
				],
			}),
		[],
	);

	return (
		<Stack gap="6" maxW="md">
			<Field.Root>
				<Field.Label>{m.language()}</Field.Label>
				<Select.Root
					collection={localeCollection}
					defaultValue={[getLocale()]}
					onValueChange={(e) => setLocale(e.value[0] as Locale)}
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
								{localeCollection.items.map((item) => (
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

			<Field.Root>
				<Field.Label>{m.theme()}</Field.Label>
				<Select.Root
					collection={themeCollection}
					value={[preference]}
					onValueChange={(e) =>
						setPreference(e.value[0] as "system" | "light" | "dark")
					}
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
								{themeCollection.items.map((item) => (
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

			<AccentColorPicker />
			<BorderRadiusPicker />

			<Field.Root>
				<Field.Label>{m.debugMode()}</Field.Label>
				<Switch.Root
					checked={debugEnabled}
					onCheckedChange={(e) => setDebugEnabled(!!e.checked)}
				>
					<Switch.HiddenInput />
					<Switch.Control />
					<Switch.Label>
						<Text fontSize="sm" color="fg.muted">
							{m.debugModeDescription()}
						</Text>
					</Switch.Label>
				</Switch.Root>
			</Field.Root>
		</Stack>
	);
}
