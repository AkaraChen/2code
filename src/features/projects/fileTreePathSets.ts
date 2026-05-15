export function buildFilePathSet(
	existingPathSet: ReadonlySet<string>,
): ReadonlySet<string> {
	const filePathSet = new Set<string>();
	for (const path of existingPathSet) {
		if (!path.endsWith("/")) {
			filePathSet.add(path);
		}
	}
	return filePathSet;
}
