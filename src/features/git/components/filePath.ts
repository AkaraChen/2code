export function splitDiffFilePath(name: string) {
	const lastSlash = name.lastIndexOf("/");
	if (lastSlash === -1) {
		return { basename: name, parentPath: null };
	}
	return {
		basename: name.slice(lastSlash + 1),
		parentPath: name.slice(0, lastSlash),
	};
}
