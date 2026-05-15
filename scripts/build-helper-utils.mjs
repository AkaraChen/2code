import { execFileSync } from "node:child_process";

const NEWLINE_PATTERN = /\r?\n/;

export function parseHostTriple(versionOutput) {
	const host = versionOutput
		.split(NEWLINE_PATTERN)
		.find((line) => line.startsWith("host: "))
		?.slice("host: ".length)
		.trim();
	if (!host) throw new Error("Could not resolve Rust host target triple");
	return host;
}

export function hostTriple() {
	return parseHostTriple(execFileSync("rustc", ["-vV"], { encoding: "utf8" }));
}
