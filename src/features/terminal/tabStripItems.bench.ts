import { bench, describe } from "vitest";
import type { TabStripGroup } from "./TabStrip";
import { collectVisibleTabItems } from "./tabStripItems";

const groups: TabStripGroup[] = Array.from({ length: 400 }, (_, groupIndex) => ({
	id: `group-${groupIndex}`,
	items:
		groupIndex % 5 === 0
			? []
			: Array.from({ length: 8 }, (_, itemIndex) => ({
					key: `tab-${groupIndex}-${itemIndex}`,
					value: `tab-${groupIndex}-${itemIndex}`,
					icon: null,
					title: `Tab ${groupIndex}-${itemIndex}`,
					maxTitleLength: 24,
				})),
}));

function collectWithFilterFlatMap() {
	return groups
		.filter((group) => group.items.length > 0)
		.flatMap((group) => group.items);
}

describe("tab strip visible item collection", () => {
	bench("filter plus flatMap items", () => {
		collectWithFilterFlatMap();
	});

	bench("single pass item collection", () => {
		collectVisibleTabItems(groups);
	});
});
