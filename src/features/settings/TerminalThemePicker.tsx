import {
	Checkbox,
	createListCollection,
	Field,
	Flex,
	IconButton,
	Portal,
	Select,
} from "@chakra-ui/react";
import { FiEye } from "react-icons/fi";
import type { TerminalThemeId } from "@/features/terminal/themes";
import {
	terminalThemeIds,
	terminalThemeNames,
} from "@/features/terminal/themes";
import * as m from "@/paraglide/messages.js";
import { useTerminalSettingsStore } from "./stores/terminalSettingsStore";

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
					<FiEye />
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
	} = useTerminalSettingsStore();

	return (
		<>
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
			<Field.Root>
				<Checkbox.Root
					size="sm"
					checked={syncTerminalTheme}
					onCheckedChange={(e) => setSyncTerminalTheme(!!e.checked)}
				>
					<Checkbox.HiddenInput />
					<Checkbox.Control />
					<Checkbox.Label>{m.syncTerminalTheme()}</Checkbox.Label>
				</Checkbox.Root>
			</Field.Root>
		</>
	);
}
