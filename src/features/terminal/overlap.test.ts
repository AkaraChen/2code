import { describe, expect, it } from "vitest";
import {
	concatBytes,
	getSuffixPrefixOverlapLength,
	getSuffixPrefixOverlapLengthBytes,
} from "./overlap";

const bytes = (s: string) => new TextEncoder().encode(s);

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

describe("getSuffixPrefixOverlapLengthBytes", () => {
	it("finds the longest byte suffix that matches the prefix source", () => {
		expect(getSuffixPrefixOverlapLengthBytes(bytes("hello world"), bytes("world!"))).toBe(5);
		expect(getSuffixPrefixOverlapLengthBytes(bytes("abcabc"), bytes("abcxyz"))).toBe(3);
		expect(getSuffixPrefixOverlapLengthBytes(bytes("terminal"), bytes("stream"))).toBe(0);
	});

	it("handles empty and shorter inputs", () => {
		expect(getSuffixPrefixOverlapLengthBytes(new Uint8Array(0), bytes("pending"))).toBe(0);
		expect(getSuffixPrefixOverlapLengthBytes(bytes("history"), new Uint8Array(0))).toBe(0);
		expect(getSuffixPrefixOverlapLengthBytes(bytes("abc"), bytes("abcdef"))).toBe(3);
	});

	it("counts multi-byte UTF-8 sequences by byte, not code point", () => {
		// 🧪 encodes to 4 UTF-8 bytes, so a full-emoji overlap is 4 bytes.
		expect(getSuffixPrefixOverlapLengthBytes(bytes("prompt 🧪"), bytes("🧪 done"))).toBe(4);
	});
});

describe("concatBytes", () => {
	it("returns the single chunk without copying", () => {
		const chunk = bytes("solo");
		expect(concatBytes([chunk])).toBe(chunk);
	});

	it("joins multiple chunks in order", () => {
		const joined = concatBytes([bytes("foo"), bytes("bar"), bytes("baz")]);
		expect(new TextDecoder().decode(joined)).toBe("foobarbaz");
	});
});
