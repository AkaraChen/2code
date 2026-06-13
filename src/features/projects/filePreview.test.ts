import { describe, expect, it } from "vitest";
import { isPreviewableBinaryFile } from "./filePreview";

describe("filePreview", () => {
	it("detects archive files as previewable binaries", () => {
		expect(isPreviewableBinaryFile("/repo/dump.sql.gz")).toBe(true);
		expect(isPreviewableBinaryFile("/repo/archive.tar.gz")).toBe(true);
		expect(isPreviewableBinaryFile("/repo/archive.tgz")).toBe(true);
	});

	it("does not treat files with archive-like names as binaries", () => {
		expect(isPreviewableBinaryFile("/repo/gzip-notes.md")).toBe(false);
		expect(isPreviewableBinaryFile("/repo/archive.gz.md")).toBe(false);
	});
});
