import type { SystemFont } from "@/generated";

export interface FontSelectItem {
	value: string;
	label: string;
}

export function buildMonoFontSelectItems(fonts: SystemFont[]): FontSelectItem[] {
	const items: FontSelectItem[] = [];
	for (const font of fonts) {
		if (!font.is_mono) continue;
		items.push({ value: font.family, label: font.family });
	}
	return items;
}
