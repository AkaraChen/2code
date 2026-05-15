import { bench, describe } from "vitest";
import type { AvailableShell } from "@/generated";
import { buildShellSelectOptions } from "./shellOptions";

const CUSTOM_SHELL_VALUE = "__custom__";

const shells: AvailableShell[] = Array.from({ length: 400 }, (_, index) => ({
	command: `/opt/homebrew/bin/shell-${index}`,
	label: `Shell ${index}`,
	is_default: index === 42,
}));

const defaultShell = shells[350].command;

function buildWithMapAndSome() {
	const items = [
		...shells.map((shell) => ({
			value: shell.command,
			label: shell.is_default ? `${shell.label} (Default)` : shell.label,
		})),
		{ value: CUSTOM_SHELL_VALUE, label: "Custom" },
	];
	const isKnownShell = shells.some((shell) => shell.command === defaultShell);
	const selectValue = isKnownShell ? defaultShell : CUSTOM_SHELL_VALUE;
	return { items, selectValue };
}

describe("shell select option construction", () => {
	bench("map plus some shell options", () => {
		buildWithMapAndSome();
	});

	bench("single pass shell options", () => {
		buildShellSelectOptions(
			shells,
			defaultShell,
			CUSTOM_SHELL_VALUE,
			"Default",
			"Custom",
		);
	});
});
