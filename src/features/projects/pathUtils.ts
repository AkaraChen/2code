const WINDOWS_ABSOLUTE_PATH_RE = /^[a-z]:[\\/]/i;
const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/;

function normalizePathSeparators(path: string) {
	return path.replace(/\\/g, "/");
}

function isAbsolutePath(path: string) {
	return path.startsWith("/") || WINDOWS_ABSOLUTE_PATH_RE.test(path);
}

export function toProfileRelativePath(rootPath: string, filePath: string) {
	const normalizedFilePath = normalizePathSeparators(filePath);
	if (!isAbsolutePath(normalizedFilePath)) {
		return normalizedFilePath.replace(/^\.\//, "");
	}

	const normalizedRootPath = normalizePathSeparators(rootPath).replace(
		TRAILING_PATH_SEPARATOR_RE,
		"",
	);

	if (normalizedFilePath === normalizedRootPath) {
		return "";
	}

	const rootPrefix = `${normalizedRootPath}/`;
	if (normalizedFilePath.startsWith(rootPrefix)) {
		return normalizedFilePath.slice(rootPrefix.length);
	}

	return normalizedFilePath;
}
