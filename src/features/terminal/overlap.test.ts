import { describe, expect, it } from "vitest";
import { getSuffixPrefixOverlapLength } from "./overlap";

describe("getSuffixPrefixOverlapLength", () => {
	it("finds the longest text suffix that matches the prefix source", () => {
		expect(getSuffixPrefixOverlapLength("hello world", "world!")).toBe(5);
		expect(getSuffixPrefixOverlapLength("abcabc", "abcxyz")).toBe(3);
		expect(getSuffixPrefixOverlapLength("terminal", "stream")).toBe(0);
	});

	it("handles empty and shorter inputs", () => {
		expect(getSuffixPrefixOverlapLength("", "pending")).toBe(0);
		expect(getSuffixPrefixOverlapLength("history", "")).toBe(0);
		expect(getSuffixPrefixOverlapLength("abc", "abcdef")).toBe(3);
	});

	it("matches UTF-16 code unit behavior", () => {
		expect(getSuffixPrefixOverlapLength("prompt 🧪", "🧪 done")).toBe(2);
	});
});
