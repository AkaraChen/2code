const FILE_TREE_PATH_COLLATOR = new Intl.Collator(undefined, {
	sensitivity: "base",
});

export function compareFileTreePaths(left: string, right: string) {
	return FILE_TREE_PATH_COLLATOR.compare(left, right);
}
