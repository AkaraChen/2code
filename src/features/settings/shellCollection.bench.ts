import { bench, describe } from "vitest";
import type { AvailableShell } from "@/generated";
import { createShellCollection } from "./shellCollection";

const shells: AvailableShell[] = Array.from({ length: 100 }, (_, index) => ({
	command: `/bin/shell-${index}`,
	label: `Shell ${index}`,
	is_default: index === 0,
}));
const cachedCollection = createShellCollection(shells, "default", "Custom");

function recordItemCount(count: number) {
	(globalThis as unknown as { shellCollectionItemCount: number })
		.shellCollectionItemCount = count;
}

describe("shell collection creation", () => {
	bench("reuse memoized shell collection", () => {
		recordItemCount(cachedCollection.items.length);
	});

	bench("recreate shell collection", () => {
		recordItemCount(
			createShellCollection(shells, "default", "Custom").items.length,
		);
	});
});
