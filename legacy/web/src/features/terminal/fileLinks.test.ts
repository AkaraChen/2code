import { describe, expect, it } from "vitest";
import {
	type FileLocation,
	detectFileLocations,
	parseFileLink,
} from "./fileLinks";

describe("detectFileLocations", () => {
	it("detects TypeScript-style file:line:col", () => {
		const results = detectFileLocations(
			"error TS2345: src/features/terminal/Terminal.tsx:172:10",
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "src/features/terminal/Terminal.tsx",
				line: 172,
				column: 10,
			},
		]);
	});

	it("detects relative path with ./", () => {
		const results = detectFileLocations(
			"  at ./tests/linkOpening.test.ts:14",
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "./tests/linkOpening.test.ts",
				line: 14,
				column: null,
			},
		]);
	});

	it("detects absolute paths", () => {
		const results = detectFileLocations(
			"/Users/me/project/src/main.ts:42:7 - error",
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "/Users/me/project/src/main.ts",
				line: 42,
				column: 7,
			},
		]);
	});

	it("detects Rust compiler error paths", () => {
		const results = detectFileLocations(
			"error[E0308]: src-tauri/crates/service/src/profile.rs:88:5",
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "src-tauri/crates/service/src/profile.rs",
				line: 88,
				column: 5,
			},
		]);
	});

	it("detects paths in parentheses (stack traces)", () => {
		const results = detectFileLocations(
			"    at Object.<anonymous> (src/features/terminal/store.ts:45:12)",
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "src/features/terminal/store.ts",
				line: 45,
				column: 12,
			},
		]);
	});

	it("ignores paths without a slash", () => {
		const results = detectFileLocations("file.ts:10:3");
		expect(results).toEqual([]);
	});

	it("ignores URLs", () => {
		const results = detectFileLocations(
			"at https://example.com/path/file.js:10:3",
		);
		expect(results).toEqual([]);
	});

	it("detects multiple file paths on one line", () => {
		const results = detectFileLocations(
			"src/a.ts:1:2 imports src/b.ts:3:4",
		);
		expect(results).toHaveLength(2);
		expect(results[0].filePath).toBe("src/a.ts");
		expect(results[1].filePath).toBe("src/b.ts");
	});

	it("handles Vitest/Jest output format", () => {
		const results = detectFileLocations(
			" FAIL  src/features/terminal/fileLinks.test.ts:22:1",
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "src/features/terminal/fileLinks.test.ts",
				line: 22,
				column: 1,
			},
		]);
	});

	it("handles Python traceback format", () => {
		const results = detectFileLocations(
			'  File "./tests/test_main.py:14", in test_foo',
		);
		expect(results).toEqual<FileLocation[]>([
			{
				filePath: "./tests/test_main.py",
				line: 14,
				column: null,
			},
		]);
	});
});

describe("parseFileLink", () => {
	it("parses path:line:col", () => {
		const result = parseFileLink("src/features/terminal/Terminal.tsx:172:10");
		expect(result).toEqual<FileLocation>({
			filePath: "src/features/terminal/Terminal.tsx",
			line: 172,
			column: 10,
		});
	});

	it("parses path:line without column", () => {
		const result = parseFileLink("./src/foo.ts:12");
		expect(result).toEqual<FileLocation>({
			filePath: "./src/foo.ts",
			line: 12,
			column: null,
		});
	});

	it("parses absolute path", () => {
		const result = parseFileLink("/Users/me/project/src/main.ts:42:7");
		expect(result).toEqual<FileLocation>({
			filePath: "/Users/me/project/src/main.ts",
			line: 42,
			column: 7,
		});
	});

	it("returns null for paths without a slash", () => {
		expect(parseFileLink("file.ts:10")).toBeNull();
	});

	it("returns null for non-matching strings", () => {
		expect(parseFileLink("not a file path")).toBeNull();
	});
});
