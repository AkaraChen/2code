import { describe, expect, it } from "vitest";
import {
	isArchiveFile,
	isPreviewableBinaryFile,
} from "./filePreview";

describe("filePreview", () => {
	it("detects gzip archives before text loading", () => {
		expect(isArchiveFile("/repo/dump.sql.gz")).toBe(true);
		expect(isArchiveFile("/repo/archive.tar.gz")).toBe(true);
		expect(isArchiveFile("/repo/archive.tgz")).toBe(true);
		expect(isPreviewableBinaryFile("/repo/dump.sql.gz")).toBe(true);
	});

	it("does not treat similarly named files as archives", () => {
		expect(isArchiveFile("/repo/gzip-notes.md")).toBe(false);
		expect(isArchiveFile("/repo/archive.gz.md")).toBe(false);
	});
});
