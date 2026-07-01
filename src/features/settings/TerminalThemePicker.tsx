import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { FiEye } from "react-icons/fi";
import type { TerminalThemeId } from "@/features/terminal/themes";
import {
	terminalThemeIds,
	terminalThemeNames,
} from "@/features/terminal/themes";
import * as m from "@/paraglide/messages.js";
import { useTerminalSettingsStore } from "./stores/terminalSettingsStore";

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
		<Field>
			<div className="flex items-center gap-2">
				<FieldLabel className="mb-0">{label}</FieldLabel>
				<Button
					aria-label={m.preview()}
					size="icon-xs"
					variant="ghost"
					className="ml-auto opacity-60 hover:opacity-100"
					onClick={() => onPreview(value)}
				>
					<FiEye />
				</Button>
			</div>
			<NativeSelect
				value={value}
				onChange={(event) => {
					onChange(event.target.value as TerminalThemeId);
					onPreview(null);
				}}
				size="sm"
			>
				{terminalThemeIds.map((id) => (
					<NativeSelectOption key={id} value={id}>
						{terminalThemeNames[id]}
					</NativeSelectOption>
				))}
			</NativeSelect>
		</Field>
	);
}

export function TerminalThemePicker({
	onPreview,
}: {
	onPreview: (id: TerminalThemeId | null) => void;
}) {
	const darkTerminalTheme = useTerminalSettingsStore(
		(state) => state.darkTerminalTheme,
	);
	const lightTerminalTheme = useTerminalSettingsStore(
		(state) => state.lightTerminalTheme,
	);
	const syncTerminalTheme = useTerminalSettingsStore(
		(state) => state.syncTerminalTheme,
	);
	const setDarkTerminalTheme = useTerminalSettingsStore(
		(state) => state.setDarkTerminalTheme,
	);
	const setLightTerminalTheme = useTerminalSettingsStore(
		(state) => state.setLightTerminalTheme,
	);
	const setSyncTerminalTheme = useTerminalSettingsStore(
		(state) => state.setSyncTerminalTheme,
	);

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
			<Field>
				<label className="flex items-center gap-2 text-sm">
					<Checkbox
						checked={syncTerminalTheme}
						onCheckedChange={setSyncTerminalTheme}
					/>
					{m.syncTerminalTheme()}
				</label>
			</Field>
		</>
	);
}
