import type { AvailableShell } from "@/generated";

export interface ShellSelectItem {
	value: string;
	label: string;
}

export interface ShellSelectOptions {
	items: ShellSelectItem[];
	selectValue: string;
}

export function buildShellSelectOptions(
	shells: AvailableShell[],
	defaultShell: string,
	customShellValue: string,
	defaultLabel: string,
	customLabel: string,
): ShellSelectOptions {
	const items: ShellSelectItem[] = new Array(shells.length + 1);
	let isKnownShell = false;

	for (let index = 0; index < shells.length; index++) {
		const shell = shells[index];
		if (shell.command === defaultShell) {
			isKnownShell = true;
		}
		items[index] = {
			value: shell.command,
			label: shell.is_default
				? `${shell.label} (${defaultLabel})`
				: shell.label,
		};
	}

	items[shells.length] = { value: customShellValue, label: customLabel };

	return {
		items,
		selectValue: isKnownShell ? defaultShell : customShellValue,
	};
}
