import { execFileSync } from "node:child_process";
import process from "node:process";
import { bench, describe } from "vitest";
import { parseHostTriple } from "./build-helper-utils.mjs";

function resolveHostTriple() {
	return parseHostTriple(execFileSync("rustc", ["-vV"], { encoding: "utf8" }));
}

describe("build-helper host triple lookup", () => {
	bench("resolve host triple once", () => {
		const host = resolveHostTriple();
		const target = process.env.TWOCODE_HELPER_TARGET || host;
		if (!target) {
			throw new Error("missing target triple");
		}
	}, { time: 500 });

	bench("resolve host triple twice", () => {
		const target = process.env.TWOCODE_HELPER_TARGET || resolveHostTriple();
		const host = resolveHostTriple();
		if (!target || !host) {
			throw new Error("missing target triple");
		}
	}, { time: 500 });
});
