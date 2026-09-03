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

/** Concatenate output chunks into a single contiguous buffer. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
	if (chunks.length === 1) return chunks[0] as Uint8Array;
	let total = 0;
	for (const chunk of chunks) total += chunk.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/**
 * Byte-level counterpart of {@link getSuffixPrefixOverlapLength}: the length of
 * the longest suffix of `bytes` that equals a prefix of `prefixSource`.
 */
export function getSuffixPrefixOverlapLengthBytes(
	bytes: Uint8Array,
	prefixSource: Uint8Array,
) {
	const maxLength = Math.min(bytes.length, prefixSource.length);
	if (maxLength === 0) return 0;

	const prefixTable = buildPrefixTableBytes(prefixSource, maxLength);
	const startIndex = bytes.length - maxLength;
	let matchedLength = 0;

	for (let index = startIndex; index < bytes.length; index += 1) {
		const current = bytes[index];
		while (
			matchedLength > 0
			&& current !== prefixSource[matchedLength]
		) {
			matchedLength = prefixTable[matchedLength - 1] ?? 0;
		}
		if (current === prefixSource[matchedLength]) {
			matchedLength += 1;
		}
	}

	return matchedLength;
}

function buildPrefixTableBytes(pattern: Uint8Array, length: number) {
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
