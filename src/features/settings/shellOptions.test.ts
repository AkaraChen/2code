import { describe, expect, it } from "vitest";
import type { AvailableShell } from "@/generated";
import { buildShellSelectOptions } from "./shellOptions";

const shells: AvailableShell[] = [
	{ command: "/bin/zsh", label: "Zsh", is_default: true },
	{ command: "/bin/bash", label: "Bash", is_default: false },
];

describe("buildShellSelectOptions", () => {
	it("selects a known shell and appends the custom option", () => {
		const options = buildShellSelectOptions(
			shells,
			"/bin/bash",
			"__custom__",
			"Default",
			"Custom",
		);

		expect(options.selectValue).toBe("/bin/bash");
		expect(options.items).toEqual([
			{ value: "/bin/zsh", label: "Zsh (Default)" },
			{ value: "/bin/bash", label: "Bash" },
			{ value: "__custom__", label: "Custom" },
		]);
	});

	it("selects the custom option for an unknown shell", () => {
		const options = buildShellSelectOptions(
			shells,
			"/opt/custom-shell",
			"__custom__",
			"Default",
			"Custom",
		);

		expect(options.selectValue).toBe("__custom__");
	});
});
