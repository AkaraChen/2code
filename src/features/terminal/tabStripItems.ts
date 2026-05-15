import type { TabStripGroup, TabStripItem } from "./TabStrip";

export function collectVisibleTabItems(
	groups: readonly TabStripGroup[],
): TabStripItem[] {
	const items: TabStripItem[] = [];
	for (const group of groups) {
		for (const item of group.items) {
			items.push(item);
		}
	}
	return items;
}
