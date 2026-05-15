export function getPathBasename(path: string) {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}
