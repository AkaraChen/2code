import {
	Checkbox,
	Field,
	Flex,
	IconButton,
	NativeSelect,
} from "@chakra-ui/react";
import { RiEyeLine } from "react-icons/ri";
import type { TerminalThemeId } from "@/lib/terminalThemes";
import { terminalThemeIds, terminalThemeNames } from "@/lib/terminalThemes";
import * as m from "@/paraglide/messages.js";
import { useFontStore } from "@/stores/fontStore";

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
			<NativeSelect.Root>
				<NativeSelect.Field
					value={value}
					onChange={(e) => {
						onChange(e.target.value as TerminalThemeId);
						onPreview(null);
					}}
				>
					{terminalThemeIds.map((id) => (
						<option key={id} value={id}>
							{terminalThemeNames[id]}
						</option>
					))}
				</NativeSelect.Field>
				<NativeSelect.Indicator />
			</NativeSelect.Root>
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
