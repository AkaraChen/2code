import {
	Checkbox,
	createListCollection,
	Field,
	Flex,
	IconButton,
	Portal,
	Select,
} from "@chakra-ui/react";
import { RiEyeLine } from "react-icons/ri";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import { terminalThemeIds, terminalThemeNames } from "@/lib/terminalThemes";
import * as m from "@/paraglide/messages.js";
import { useFontStore } from "@/stores/fontStore";

const themeCollection = createListCollection({
	items: terminalThemeIds.map((id) => ({
		value: id,
		label: terminalThemeNames[id],
	})),
});

function ThemeSelect({
	value,
	onChange,
	label,
	onPreview,
}: {
	value: TerminalThemeId;
	onChange: (id: TerminalThemeId) => void;
	label: string;
	onPreview: (id: TerminalThemeId | null) => void;
}) {
	return (
		<Field.Root>
			<Flex align="center">
				<Field.Label mb="0">{label}</Field.Label>
				<IconButton
					aria-label={m.preview()}
					size="2xs"
					variant="ghost"
					ml="auto"
					opacity={0.5}
					_hover={{ opacity: 1 }}
					onClick={() => onPreview(value)}
				>
					<RiEyeLine />
				</IconButton>
			</Flex>
			<Select.Root
				collection={themeCollection}
				value={[value]}
				onValueChange={(e) => {
					onChange(e.value[0] as TerminalThemeId);
					onPreview(null);
				}}
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
	);
}

export function TerminalThemePicker({
	onPreview,
}: {
	onPreview: (id: TerminalThemeId | null) => void;
}) {
	const {
		darkTerminalTheme,
		lightTerminalTheme,
		syncTerminalTheme,
		setDarkTerminalTheme,
		setLightTerminalTheme,
		setSyncTerminalTheme,
	} = useFontStore();

	return (
		<>
			<Checkbox.Root
				size="sm"
				checked={syncTerminalTheme}
				onCheckedChange={(e) => setSyncTerminalTheme(!!e.checked)}
			>
				<Checkbox.HiddenInput />
				<Checkbox.Control />
				<Checkbox.Label>{m.syncTerminalTheme()}</Checkbox.Label>
			</Checkbox.Root>
			{syncTerminalTheme ? (
				<ThemeSelect
					value={darkTerminalTheme}
					onChange={setDarkTerminalTheme}
					label={m.terminalTheme()}
					onPreview={onPreview}
				/>
			) : (
				<>
					<ThemeSelect
						value={darkTerminalTheme}
						onChange={setDarkTerminalTheme}
						label={m.terminalThemeDark()}
						onPreview={onPreview}
					/>
					<ThemeSelect
						value={lightTerminalTheme}
						onChange={setLightTerminalTheme}
						label={m.terminalThemeLight()}
						onPreview={onPreview}
					/>
				</>
			)}
		</>
	);
}
