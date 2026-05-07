import { copyFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2] === "release" ? "release" : "debug";
const root = fileURLToPath(new URL("..", import.meta.url));
const srcTauri = join(root, "src-tauri");

function hostTriple() {
	const version = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
	const host = version
		.split(/\r?\n/)
		.find((line) => line.startsWith("host: "))
		?.slice("host: ".length)
		.trim();
	if (!host) throw new Error("Could not resolve Rust host target triple");
	return host;
}

const targetTriple = process.env.TWOCODE_HELPER_TARGET || hostTriple();
const host = hostTriple();
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
