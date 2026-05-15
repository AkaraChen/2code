export interface SoundSelectItem {
	value: string;
	label: string;
}

export function buildSoundSelectItems(
	sounds: readonly string[],
	noneLabel: string,
): SoundSelectItem[] {
	const items = new Array<SoundSelectItem>(sounds.length + 1);
	items[0] = { value: "", label: noneLabel };

	for (let index = 0; index < sounds.length; index++) {
		const sound = sounds[index];
		items[index + 1] = { value: sound, label: sound };
	}

	return items;
}
