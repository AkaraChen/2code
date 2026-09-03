const imageMimeTypes: Record<string, string> = {
	apng: "image/apng",
	avif: "image/avif",
	bmp: "image/bmp",
	cur: "image/x-icon",
	gif: "image/gif",
	ico: "image/x-icon",
	jfif: "image/jpeg",
	jpe: "image/jpeg",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	pjp: "image/jpeg",
	pjpeg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
};

const officeExtensions = new Set([
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"odt",
	"ods",
	"odp",
]);

function getBasename(filePath: string) {
	return filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

function getFileExtension(filePath: string) {
	const basename = getBasename(filePath);
	const dotIndex = basename.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === basename.length - 1) return "";
	return basename.slice(dotIndex + 1);
}

function getPreviewableImageMimeType(filePath: string) {
	return imageMimeTypes[getFileExtension(filePath)] ?? null;
}

function isPdfFile(filePath: string) {
	return getFileExtension(filePath) === "pdf";
}

function isOfficeFile(filePath: string) {
	return officeExtensions.has(getFileExtension(filePath));
}

const archiveSuffixes = [".zip", ".tar", ".tar.gz", ".tgz", ".gz"];

export function isPreviewableBinaryFile(filePath: string) {
	const basename = getBasename(filePath);
	const isArchive = archiveSuffixes.some((suffix) => basename.endsWith(suffix));

	return (
		getPreviewableImageMimeType(filePath) != null
		|| isPdfFile(filePath)
		|| isOfficeFile(filePath)
		|| isArchive
	);
}
