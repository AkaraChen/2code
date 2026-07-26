import { describe, expect, it } from "vitest";
import { computeReachableIconFilenames } from "./vite-plugin-local-file-icons";

describe("computeReachableIconFilenames", () => {
	it("includes the default icons", () => {
		const names = computeReachableIconFilenames();

		for (const name of [
			"default_file.svg",
			"default_folder.svg",
			"default_folder_opened.svg",
			"default_root_folder.svg",
			"default_root_folder_opened.svg",
		]) {
			expect(names.has(name)).toBe(true);
		}
	});

	it("includes synthesized opened variants for folder icons", () => {
		const names = computeReachableIconFilenames();

		expect(names.has("folder_type_src.svg")).toBe(true);
		expect(names.has("folder_type_src_opened.svg")).toBe(true);
		expect(names.has("folder_type_test.svg")).toBe(true);
		expect(names.has("folder_type_test_opened.svg")).toBe(true);
	});

	it("includes mapped icons that may need clone-time aliases", () => {
		const names = computeReachableIconFilenames();

		expect(names.has("file_type_makefile.svg")).toBe(true);
		expect(names.has("file_type_webp.svg")).toBe(true);
		expect(names.has("file_type_light_zeit.svg")).toBe(true);
	});

	it("covers the full vscode-icons-js mapping inventory", () => {
		expect(computeReachableIconFilenames().size).toBeGreaterThanOrEqual(800);
	});
});
