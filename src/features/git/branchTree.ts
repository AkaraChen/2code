// Group a flat list of branch/tag names into a folder tree by `/` segments.
//
//   ["main", "feat/auth/login", "feat/auth/logout", "fix/typo"]
//
// becomes
//
//   - main                       (leaf)
//   - feat/                      (folder)
//     - auth/                    (folder)
//       - login                  (leaf, name "feat/auth/login")
//       - logout                 (leaf, name "feat/auth/logout")
//   - fix/                       (folder)
//     - typo                     (leaf, name "fix/typo")
//
// Sort order at each level: directories first (alphabetical), then leaves
// (alphabetical), with `main` and `master` always at the top of root-level
// leaves. Generic over the leaf payload so the same tree works for
// branches, tags, and remote branches.

export interface BranchTreeFolder<T> {
	kind: "folder";
	/// Last segment of the path, e.g. "auth" inside "feat/auth/".
	name: string;
	/// Full path up to and including this folder, e.g. "feat/auth".
	path: string;
	children: BranchTreeNode<T>[];
}

export interface BranchTreeLeaf<T> {
	kind: "leaf";
	/// Last segment of the path, e.g. "login" inside "feat/auth/login".
	name: string;
	/// Full original branch/tag name, e.g. "feat/auth/login".
	path: string;
	value: T;
}

export type BranchTreeNode<T> = BranchTreeFolder<T> | BranchTreeLeaf<T>;

const PRIORITY_ROOT_LEAVES = new Set(["main", "master", "trunk", "develop"]);

/// Build a tree of folders + leaves from a flat list of items keyed by name.
/// `getName` extracts the slash-separated path from each item.
export function buildBranchTree<T>(
	items: readonly T[],
	getName: (item: T) => string,
): BranchTreeNode<T>[] {
	const root: FolderBuilder<T> = { children: new Map(), leaves: [] };

	for (const item of items) {
		const fullName = getName(item);
		// Normalize: drop leading/trailing slashes, collapse `//`.
		const segments = fullName
			.split("/")
			.filter((s) => s.length > 0);
		if (segments.length === 0) continue;

		let cursor = root;
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i];
			let child = cursor.children.get(segment);
			if (!child) {
				child = { children: new Map(), leaves: [] };
				cursor.children.set(segment, child);
			}
			cursor = child;
		}
		const leafName = segments[segments.length - 1];
		cursor.leaves.push({ name: leafName, path: fullName, value: item });
	}

	return materialize(root, "");
}

interface FolderBuilder<T> {
	children: Map<string, FolderBuilder<T>>;
	leaves: { name: string; path: string; value: T }[];
}

function materialize<T>(
	folder: FolderBuilder<T>,
	parentPath: string,
): BranchTreeNode<T>[] {
	// Folders first, alphabetical by name.
	const folderNodes: BranchTreeFolder<T>[] = Array.from(folder.children)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, sub]) => {
			const path = parentPath ? `${parentPath}/${name}` : name;
			return {
				kind: "folder" as const,
				name,
				path,
				children: materialize(sub, path),
			};
		});

	// Leaves second, with priority leaves (main/master/...) at root.
	const leafNodes: BranchTreeLeaf<T>[] = folder.leaves
		.slice()
		.sort((a, b) => {
			if (parentPath === "") {
				const aPriority = PRIORITY_ROOT_LEAVES.has(a.name);
				const bPriority = PRIORITY_ROOT_LEAVES.has(b.name);
				if (aPriority && !bPriority) return -1;
				if (!aPriority && bPriority) return 1;
			}
			return a.name.localeCompare(b.name);
		})
		.map((l) => ({
			kind: "leaf" as const,
			name: l.name,
			path: l.path,
			value: l.value,
		}));

	return [...folderNodes, ...leafNodes];
}
