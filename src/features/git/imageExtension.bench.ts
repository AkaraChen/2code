import { bench, describe } from "vitest";
import { getPreviewableImageMimeType } from "./utils";

const fileNames = Array.from({ length: 100_000 }, (_, index) =>
	`src/path.with.dots/file-${index}.preview.${index % 2 === 0 ? "PNG" : "txt"}`,
);
const previewableImageMimeTypes: Record<string, string> = {
	png: "image/png",
	txt: "text/plain",
};

function splitExtension(fileName: string) {
	const extension = fileName.split(".").pop()?.toLowerCase();
	if (!extension) return null;
	return previewableImageMimeTypes[extension] ?? null;
}

function lastIndexExtension(fileName: string) {
	const extensionStart = fileName.lastIndexOf(".");
	if (extensionStart < 0 || extensionStart === fileName.length - 1) {
		return null;
	}

	const extension = fileName.slice(extensionStart + 1).toLowerCase();
	return previewableImageMimeTypes[extension] ?? null;
}

describe("git image extension lookup", () => {
	bench("split extension", () => {
		let count = 0;
		for (const fileName of fileNames) {
			if (splitExtension(fileName)) count++;
		}
		if (count !== fileNames.length) {
			throw new Error("split extension missed extensions");
		}
	});

	bench("lastIndexOf extension", () => {
		let count = 0;
		for (const fileName of fileNames) {
			if (lastIndexExtension(fileName)) count++;
		}
		if (count !== fileNames.length) {
			throw new Error("lastIndexOf extension missed extensions");
		}
	});

	bench("production lookup", () => {
		let count = 0;
		for (const fileName of fileNames) {
			if (getPreviewableImageMimeType(fileName)) count++;
		}
		if (count !== fileNames.length / 2) {
			throw new Error("production lookup returned wrong image count");
		}
	});
});
