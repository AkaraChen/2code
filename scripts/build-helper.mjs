import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { hostTriple } from "./build-helper-utils.mjs";

const mode = process.argv[2] === "release" ? "release" : "debug";
const root = fileURLToPath(new URL("..", import.meta.url));
const srcTauri = join(root, "src-tauri");

const host = hostTriple();
const targetTriple = process.env.TWOCODE_HELPER_TARGET || host;
const isWindows = targetTriple.includes("windows");
const binSuffix = isWindows ? ".exe" : "";
const cargoArgs = ["build", "-p", "twocode-helper"];

if (mode === "release") cargoArgs.push("--release");
if (targetTriple !== host) cargoArgs.push("--target", targetTriple);

execFileSync("cargo", cargoArgs, { cwd: srcTauri, stdio: "inherit" });

const targetDir =
	targetTriple === host
		? join(srcTauri, "target", mode)
		: join(srcTauri, "target", targetTriple, mode);
const binariesDir = join(srcTauri, "binaries");
const source = join(targetDir, `2code-helper${binSuffix}`);
const destination = join(
	binariesDir,
	`2code-helper-${targetTriple}${binSuffix}`,
);

mkdirSync(binariesDir, { recursive: true });
copyFileSync(source, destination);

try {
	chmodSync(destination, 0o755);
} catch {
	// chmod is not meaningful on Windows.
}
