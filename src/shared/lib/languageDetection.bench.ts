import { bench, describe } from "vitest";
import { detectLanguage } from "./languageDetection";

const filenames = Array.from({ length: 100_000 }, (_, index) =>
	index % 10 === 0
		? "Dockerfile"
		: `src/path.with.dots/file-${index}.component.${index % 2 === 0 ? "TSX" : "md"}`,
);
const extMap: Record<string, string> = {
	dockerfile: "docker",
	md: "markdown",
	tsx: "tsx",
};
const nameMap: Record<string, string> = {
	dockerfile: "docker",
};

function splitDetectLanguage(filename: string) {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const baseName = filename.toLowerCase();
	return nameMap[baseName] ?? extMap[ext] ?? "text";
}

function lastIndexDetectLanguage(filename: string) {
	const extensionStart = filename.lastIndexOf(".");
	const ext =
		extensionStart >= 0 && extensionStart < filename.length - 1
			? filename.slice(extensionStart + 1).toLowerCase()
			: "";
	const baseName = filename.toLowerCase();
	return nameMap[baseName] ?? extMap[ext] ?? "text";
}

describe("language detection extension lookup", () => {
	bench("split extension", () => {
		let typed = 0;
		for (const filename of filenames) {
			if (splitDetectLanguage(filename) !== "text") typed++;
		}
		if (typed !== filenames.length) {
			throw new Error("split detection missed languages");
		}
	});

	bench("lastIndexOf extension", () => {
		let typed = 0;
		for (const filename of filenames) {
			if (lastIndexDetectLanguage(filename) !== "text") typed++;
		}
		if (typed !== filenames.length) {
			throw new Error("lastIndexOf detection missed languages");
		}
	});

	bench("production detection", () => {
		let typed = 0;
		for (const filename of filenames) {
			if (detectLanguage(filename) !== "text") typed++;
		}
		if (typed !== filenames.length) {
			throw new Error("production detection missed languages");
		}
	});
});
