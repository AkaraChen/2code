import { bench, describe } from "vitest";
import { parseProjectAvatarCache } from "./projectAvatarCache";

const parsed = Object.fromEntries(
	Array.from({ length: 20_000 }, (_, index) => [
		`project-${index}`,
		index % 5 === 0 ? null : `https://example.com/avatar-${index}.png`,
	]),
);
let sink = 0;

function parseProjectAvatarCacheWithEntries(parsed: unknown) {
	const cache: Record<string, string | null> = {};
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		!Array.isArray(parsed)
	) {
		const entries = Object.entries(parsed);
		for (const [key, value] of entries) {
			if (typeof value === "string" || value === null) {
				cache[key] = value;
			}
		}
	}
	return cache;
}

describe("project avatar cache parsing", () => {
	bench("Object.entries cache parse", () => {
		const cache = parseProjectAvatarCacheWithEntries(parsed);
		sink = Object.keys(cache).length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});

	bench("for-in cache parse", () => {
		const cache = parseProjectAvatarCache(parsed);
		sink = Object.keys(cache).length;
		if (sink === Number.NEGATIVE_INFINITY) throw new Error("unreachable");
	});
});
