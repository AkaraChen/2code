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

const archiveSuffixes = [
	".zip",
	".tar",
	".tar.gz",
	".tgz",
	".gz",
];

function getBasename(filePath: string) {
	return filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

export function getFileExtension(filePath: string) {
	const basename = getBasename(filePath);
	const dotIndex = basename.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === basename.length - 1) return "";
	return basename.slice(dotIndex + 1);
}

export function getCompoundFileExtension(filePath: string) {
	const basename = getBasename(filePath);
	if (basename.endsWith(".tar.gz")) return "tar.gz";
	return getFileExtension(filePath);
}

export function getPreviewableImageMimeType(filePath: string) {
	return imageMimeTypes[getFileExtension(filePath)] ?? null;
}

export function isPdfFile(filePath: string) {
	return getFileExtension(filePath) === "pdf";
}

export function isOfficeFile(filePath: string) {
	return officeExtensions.has(getFileExtension(filePath));
}

export function isArchiveFile(filePath: string) {
	const basename = getBasename(filePath);
	return archiveSuffixes.some((suffix) => basename.endsWith(suffix));
}

export function isPreviewableBinaryFile(filePath: string) {
	return (
		getPreviewableImageMimeType(filePath) != null
		|| isPdfFile(filePath)
		|| isOfficeFile(filePath)
		|| isArchiveFile(filePath)
	);
}
