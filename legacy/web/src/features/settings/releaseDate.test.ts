import { describe, expect, it } from "vitest";
import { formatReleaseDate, getRelativeTimeValue } from "./releaseDate";

describe("releaseDate", () => {
	it("formats release dates and keeps invalid dates unchanged", () => {
		expect(formatReleaseDate(null, "en")).toBeNull();
		expect(formatReleaseDate("not-a-date", "en")).toBe("not-a-date");
		expect(formatReleaseDate("2026-05-15T00:00:00Z", "en")).toContain(
			"2026",
		);
	});

	it("computes relative time buckets", () => {
		const now = Date.UTC(2026, 4, 15, 0, 0, 0);
		expect(getRelativeTimeValue(new Date(now + 30_000), now)).toEqual({
			value: 30,
			unit: "second",
		});
		expect(getRelativeTimeValue(new Date(now - 90_000), now)).toEqual({
			value: -1,
			unit: "minute",
		});
	});
});
