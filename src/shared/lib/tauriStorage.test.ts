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
	});
});
