import { describe, expect, it } from "vitest";
import { tauriStorage } from "./tauriStorage";

describe("tauriStorage", () => {
	describe("getItem", () => {
		it("returns JSON stringified value for existing key", async () => {
			await tauriStorage.setItem("key", JSON.stringify({ a: 1 }));
			const result = await tauriStorage.getItem("key");
			expect(result).toBe(JSON.stringify({ a: 1 }));
		});

		it("returns null for non-existent key", async () => {
			const result = await tauriStorage.getItem("nonexistent");
			expect(result).toBeNull();
		});
	});

	describe("setItem", () => {
		it("stores parsed JSON value", async () => {
			await tauriStorage.setItem("obj", '{"x":42}');
			const result = await tauriStorage.getItem("obj");
			expect(result).toBe('{"x":42}');
		});

		it("handles string values", async () => {
			await tauriStorage.setItem("str", '"hello"');
			const result = await tauriStorage.getItem("str");
			expect(result).toBe('"hello"');
		});
	});

	describe("removeItem", () => {
		it("removes the key from storage", async () => {
			await tauriStorage.setItem("temp", '"val"');
			await tauriStorage.removeItem("temp");
			const result = await tauriStorage.getItem("temp");
			expect(result).toBeNull();
		});

		it("does not throw when removing non-existent key", async () => {
			await expect(
				tauriStorage.removeItem("never-set"),
			).resolves.not.toThrow();
		});
	});

	describe("edge cases", () => {
		it("setItem throws on invalid JSON string", async () => {
			// JSON.parse("not json") throws SyntaxError
			await expect(
				tauriStorage.setItem("bad", "not json"),
			).rejects.toThrow(SyntaxError);
		});

		it("setItem throws on empty string", async () => {
			// JSON.parse("") throws SyntaxError
			await expect(tauriStorage.setItem("bad", "")).rejects.toThrow(
				SyntaxError,
			);
		});

		it("round-trips numeric zero correctly", async () => {
			await tauriStorage.setItem("zero", "0");
			// store.get returns 0, val != null is true, JSON.stringify(0) = "0"
			const result = await tauriStorage.getItem("zero");
			expect(result).toBe("0");
		});

		it("round-trips boolean false correctly", async () => {
			await tauriStorage.setItem("bool", "false");
			const result = await tauriStorage.getItem("bool");
			expect(result).toBe("false");
		});

		it("round-trips null value — getItem returns null", async () => {
			// JSON.parse("null") = null, store.set("k", null)
			// store.get("k") returns null, val != null → false → returns null
			await tauriStorage.setItem("nul", "null");
			const result = await tauriStorage.getItem("nul");
			expect(result).toBeNull();
		});

		it("round-trips nested objects", async () => {
			const obj = JSON.stringify({ a: { b: [1, 2, 3] } });
			await tauriStorage.setItem("nested", obj);
			expect(await tauriStorage.getItem("nested")).toBe(obj);
		});

		it("handles special characters in key names", async () => {
			await tauriStorage.setItem("key/with:special.chars!", '"v"');
			expect(
				await tauriStorage.getItem("key/with:special.chars!"),
			).toBe('"v"');
		});

		it("overwrites existing key on setItem", async () => {
			await tauriStorage.setItem("dup", '"first"');
			await tauriStorage.setItem("dup", '"second"');
			expect(await tauriStorage.getItem("dup")).toBe('"second"');
		});
	});
});
