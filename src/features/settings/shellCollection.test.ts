import { describe, expect, it } from "vitest";
import type { AvailableShell } from "@/generated";
import { createShellCollection, CUSTOM_SHELL_VALUE } from "./shellCollection";

const shells: AvailableShell[] = [
	{ command: "/bin/zsh", label: "zsh", is_default: true },
	{ command: "/bin/bash", label: "bash", is_default: false },
];

describe("createShellCollection", () => {
	it("builds shell select items with default and custom labels", () => {
		const collection = createShellCollection(shells, "default", "Custom");

		expect(collection.items).toEqual([
			{ value: "/bin/zsh", label: "zsh (default)" },
			{ value: "/bin/bash", label: "bash" },
			{ value: CUSTOM_SHELL_VALUE, label: "Custom" },
		]);
	});
});
