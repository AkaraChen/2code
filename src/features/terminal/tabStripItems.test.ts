import { describe, expect, it } from "vitest";
import type { TabStripGroup } from "./TabStrip";
import { collectVisibleTabItems } from "./tabStripItems";

const groups: TabStripGroup[] = [
	{ id: "empty", items: [] },
	{
		id: "terminal",
		items: [
			{
				key: "a",
				value: "a",
				icon: null,
				title: "A",
				maxTitleLength: 24,
			},
		],
	},
];

describe("collectVisibleTabItems", () => {
	it("returns items from non-empty groups in order", () => {
		expect(collectVisibleTabItems(groups)).toEqual([groups[1].items[0]]);
	});
});
