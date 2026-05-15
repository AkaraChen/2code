import { createListCollection } from "@chakra-ui/react";
import type { AvailableShell } from "@/generated";

export const CUSTOM_SHELL_VALUE = "__custom__";

export function createShellCollection(
	shells: readonly AvailableShell[],
	defaultLabel: string,
	customLabel: string,
) {
	return createListCollection({
		items: [
			...shells.map((shell) => ({
				value: shell.command,
				label: shell.is_default
					? `${shell.label} (${defaultLabel})`
					: shell.label,
			})),
			{ value: CUSTOM_SHELL_VALUE, label: customLabel },
		],
	});
}
