import type { FileDiffMetadata } from "@pierre/diffs";

export interface ChangeFileNames {
	names: string[];
	nameSet: Set<string>;
}

export function collectChangeFileNames(
	files: readonly Pick<FileDiffMetadata, "name">[],
): ChangeFileNames {
	const names = new Array<string>(files.length);
	const nameSet = new Set<string>();

	for (let index = 0; index < files.length; index++) {
		const name = files[index].name;
		names[index] = name;
		nameSet.add(name);
	}

	return { names, nameSet };
}
