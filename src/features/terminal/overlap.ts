export function getSuffixPrefixOverlapLength(
	text: string,
	prefixSource: string,
) {
	const maxLength = Math.min(text.length, prefixSource.length);
	if (maxLength === 0) return 0;

	// KMP prefix table: scan only the relevant text suffix once, instead of
	// repeatedly slicing prefixSource and asking text.endsWith(...) for every
	// possible overlap length.
	const prefixTable = buildPrefixTable(prefixSource, maxLength);
	const startIndex = text.length - maxLength;
	let matchedLength = 0;

	for (let index = startIndex; index < text.length; index += 1) {
		const current = text[index];
		while (matchedLength > 0 && current !== prefixSource[matchedLength]) {
			matchedLength = prefixTable[matchedLength - 1] ?? 0;
		}
		if (current === prefixSource[matchedLength]) {
			matchedLength += 1;
		}
	}

	return matchedLength;
}

function buildPrefixTable(pattern: string, length: number) {
	const table = Array.from<number>({ length }).fill(0);
	let matchedLength = 0;

	for (let index = 1; index < length; index += 1) {
		const current = pattern[index];
		while (matchedLength > 0 && current !== pattern[matchedLength]) {
			matchedLength = table[matchedLength - 1] ?? 0;
		}
		if (current === pattern[matchedLength]) {
			matchedLength += 1;
		}
		table[index] = matchedLength;
	}

	return table;
}
