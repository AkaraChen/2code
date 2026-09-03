import { use } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import type { AvailableShell } from "@/generated";
import { listAvailableShells } from "@/generated";
import * as m from "@/paraglide/messages.js";
import { createCachedPromise } from "@/shared/lib/cachedPromise";
import { useTerminalSettingsStore } from "./stores/terminalSettingsStore";

const CUSTOM_SHELL_VALUE = "__custom__";

const getShellsPromise = createCachedPromise<AvailableShell[]>(() =>
	listAvailableShells(),
);

export function ShellPicker() {
	const shells = use(getShellsPromise());
	const defaultShell = useTerminalSettingsStore(
		(state) => state.defaultShell,
	);
	const setDefaultShell = useTerminalSettingsStore(
		(state) => state.setDefaultShell,
	);

	const isKnownShell = shells.some((shell) => shell.command === defaultShell);
	const selectValue = isKnownShell ? defaultShell : CUSTOM_SHELL_VALUE;

	return (
		<Field>
			<FieldLabel>{m.defaultShell()}</FieldLabel>
			<div className="flex flex-col gap-2">
				<NativeSelect
					value={selectValue}
					onChange={(event) => {
						const value = event.target.value;
						if (!value || value === CUSTOM_SHELL_VALUE) return;
						setDefaultShell(value);
					}}
					size="sm"
				>
					{shells.map((shell) => (
						<NativeSelectOption key={shell.command} value={shell.command}>
							{shell.is_default
								? `${shell.label} (${m.defaultOption()})`
								: shell.label}
						</NativeSelectOption>
					))}
					<NativeSelectOption value={CUSTOM_SHELL_VALUE}>
						{m.customShell()}
					</NativeSelectOption>
				</NativeSelect>

				{selectValue === CUSTOM_SHELL_VALUE ? (
					<Input
						value={defaultShell}
						onChange={(event) => setDefaultShell(event.target.value)}
						placeholder={m.customShellPlaceholder()}
						className="font-mono"
					/>
				) : null}

				<FieldDescription>{m.defaultShellDescription()}</FieldDescription>
			</div>
		</Field>
	);
}
