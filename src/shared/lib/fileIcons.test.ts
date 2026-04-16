import { describe, expect, it, vi } from "vitest";

const {
	getIconForFileMock,
	getIconForFolderMock,
	getIconForOpenFolderMock,
} = vi.hoisted(() => ({
	getIconForFileMock: vi.fn(),
	getIconForFolderMock: vi.fn(),
	getIconForOpenFolderMock: vi.fn(),
}));

vi.mock("vscode-icons-js", () => ({
	getIconForFile: getIconForFileMock,
	getIconForFolder: getIconForFolderMock,
	getIconForOpenFolder: getIconForOpenFolderMock,
}));

import { getFileIconUrl, getFolderIconUrl } from "./fileIcons";

describe("fileIcons", () => {
	it("builds file icon urls and falls back to the default icon", () => {
		getIconForFileMock.mockReturnValueOnce("typescript.svg");
		getIconForFileMock.mockReturnValueOnce(undefined);

		expect(getFileIconUrl("index.ts")).toBe("/file-icons/typescript.svg");
		expect(getFileIconUrl("unknown.ext")).toBe(
			"/file-icons/default_file.svg",
		);
	});

	it("uses the closed folder icon when the folder is collapsed", () => {
		getIconForFolderMock.mockReturnValue("folder.svg");

		expect(getFolderIconUrl("src", false)).toBe("/file-icons/folder.svg");
		expect(getIconForFolderMock).toHaveBeenCalledWith("src");
		expect(getIconForOpenFolderMock).not.toHaveBeenCalled();
	});

	it("uses the open folder icon when the folder is expanded", () => {
		getIconForOpenFolderMock.mockReturnValue("folder-open.svg");

		expect(getFolderIconUrl("src", true)).toBe(
			"/file-icons/folder-open.svg",
		);
		expect(getIconForOpenFolderMock).toHaveBeenCalledWith("src");
	});
});
