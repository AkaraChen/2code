import { describe, expect, it, vi } from "vitest";
import {
	FILE_TREE_TERMINAL_DROP_MIME,
	createFileTreeTerminalDropPayload,
	formatTerminalPathInput,
	readFileTreeTerminalDropPayload,
	writeFileTreeTerminalDropPayload,
} from "./fileTreeTerminalDrop";

function createTestDataTransfer(): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = [];
	const transfer = {
		dropEffect: "none",
		effectAllowed: "uninitialized",
		files: [] as unknown as FileList,
		items: [] as unknown as DataTransferItemList,
		types,
		clearData: vi.fn(),
		getData: vi.fn((format: string) => data.get(format) ?? ""),
		setData: vi.fn((format: string, value: string) => {
			data.set(format, value);
			if (!types.includes(format)) types.push(format);
		}),
		setDragImage: vi.fn(),
	} as unknown as DataTransfer;
	return transfer;
}

describe("fileTreeTerminalDrop", () => {
	it("round-trips file tree terminal drop payloads", () => {
		const dataTransfer = createTestDataTransfer();
		const payload = createFileTreeTerminalDropPayload({
			profileId: "profile-1",
			rootPath: "/root",
			relativePaths: ["src/index.ts"],
			absolutePaths: ["/root/src/index.ts"],
		});

		writeFileTreeTerminalDropPayload(dataTransfer, payload);

		expect(dataTransfer.effectAllowed).toBe("copyMove");
		expect(dataTransfer.types).toContain(FILE_TREE_TERMINAL_DROP_MIME);
		expect(dataTransfer.getData("text/plain")).toBe("/root/src/index.ts");
		expect(readFileTreeTerminalDropPayload(dataTransfer)).toEqual(payload);
	});

	it("formats terminal input as raw absolute paths", () => {
		expect(
			formatTerminalPathInput([
				"/root/src/index.ts",
				"/root/path with spaces/file.ts",
			]),
		).toBe("/root/src/index.ts /root/path with spaces/file.ts");
	});
});
