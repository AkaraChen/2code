import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { argv, env, exit, platform } from "node:process";
import { fileURLToPath } from "node:url";

const PINNED_VERSION = "0.9.0";
const PINNED_TAG = "v0.9.0";

const RUSTC_TO_PIN_TARGET = {
	"x86_64-unknown-linux-gnu": "x86_64-unknown-linux",
	"aarch64-unknown-linux-gnu": "aarch64-unknown-linux",
	"aarch64-apple-darwin": "aarch64-apple-darwin",
	"x86_64-apple-darwin": "x86_64-apple-darwin",
	"x86_64-pc-windows-msvc": "x86_64-pc-windows-msvc",
};

export function sidecarFileName(rustcTriple) {
	if (
		rustcTriple === "aarch64-pc-windows-msvc" ||
		(rustcTriple.includes("windows") && rustcTriple.includes("aarch64"))
	) {
		throw new Error(
			"Windows ARM64 is unsupported; Herdr v0.9.0 has no stable asset",
		);
	}
	if (!Object.hasOwn(RUSTC_TO_PIN_TARGET, rustcTriple)) {
		throw new Error(`unknown sidecar triple: ${rustcTriple}`);
	}
	const ext = rustcTriple.includes("windows") ? ".exe" : "";
	return `herdr-${rustcTriple}${ext}`;
}

export function pinTargetForTriple(rustcTriple) {
	sidecarFileName(rustcTriple);
	return RUSTC_TO_PIN_TARGET[rustcTriple];
}

export function sha256File(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function verifySha256(filePath, expected) {
	const actual = sha256File(filePath);
	if (actual !== expected) {
		throw new Error(
			`SHA-256 mismatch for ${filePath}: expected ${expected}, got ${actual}`,
		);
	}
	return actual;
}

export function loadPin(pinPath) {
	const pin = JSON.parse(readFileSync(pinPath, "utf8"));
	if (pin.version !== PINNED_VERSION || pin.tag !== PINNED_TAG) {
		throw new Error(
			`pin.json must record Herdr ${PINNED_TAG}, got ${pin.tag} (${pin.version})`,
		);
	}
	return pin;
}

export function assetForTriple(pin, rustcTriple) {
	const pinTarget = pinTargetForTriple(rustcTriple);
	const asset = pin.assets.find((item) => item.target === pinTarget);
	if (!asset) {
		throw new Error(`no pin.json asset for ${rustcTriple}`);
	}
	if (
		typeof asset.url !== "string" ||
		asset.url.includes("/latest/") ||
		!asset.url.includes(`/download/${PINNED_TAG}/`)
	) {
		throw new Error(
			`refusing to download latest or unpinned URL for ${asset.name}: ${asset.url}`,
		);
	}
	return asset;
}

export function cacheDir(pin) {
	const root = env.XDG_CACHE_HOME
		? env.XDG_CACHE_HOME
		: path.join(env.HOME || homedir(), ".cache");
	return path.join(root, "2code", "herdr", `v${pin.version}`);
}

export function defaultPinPath() {
	return path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"src-tauri",
		"crates",
		"infra",
		"tests",
		"fixtures",
		"herdr",
		"pin.json",
	);
}

export function defaultBinariesDir() {
	return path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"src-tauri",
		"binaries",
	);
}

export function resolveTarget(explicit) {
	if (explicit) {
		return explicit;
	}
	for (const key of [
		"HERDR_TARGET",
		"CARGO_BUILD_TARGET",
		"TAURI_ENV_TARGET_TRIPLE",
	]) {
		if (env[key]) {
			return env[key];
		}
	}
	const rustc = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
	const match = rustc.match(/^host:\s+(\S+)/m);
	if (!match) {
		throw new Error("could not read rustc host triple");
	}
	return match[1];
}

function extractZipMember(zipPath, member, destPath) {
	const staging = `${destPath}.extract`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	try {
		execFileSync("tar", ["-xf", zipPath, "-C", staging, member], {
			stdio: "pipe",
		});
	} catch {
		execFileSync(
			"python3",
			[
				"-c",
				"import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extract(sys.argv[2], sys.argv[3])",
				zipPath,
				member,
				staging,
			],
			{ stdio: "pipe" },
		);
	}
	const extracted = path.join(staging, member);
	if (!existsSync(extracted)) {
		throw new Error(`zip did not contain ${member}: ${zipPath}`);
	}
	renameSync(extracted, destPath);
	rmSync(staging, { recursive: true, force: true });
}

async function downloadTo(url, dest) {
	const response = await fetch(url, {
		headers: { "User-Agent": "2code-herdr-sidecar/0.9.0" },
		redirect: "follow",
	});
	if (!response.ok) {
		throw new Error(`download failed ${response.status} ${url}`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	const tmp = `${dest}.download`;
	writeFileSync(tmp, bytes);
	renameSync(tmp, dest);
}

export async function installSidecar(options = {}) {
	const pin = loadPin(options.pinPath ?? defaultPinPath());
	const target = resolveTarget(options.target);
	const asset = assetForTriple(pin, target);
	const destName = sidecarFileName(target);
	const binariesDir = options.binariesDir ?? defaultBinariesDir();
	const dest = path.join(binariesDir, destName);
	const cache = cacheDir(pin);
	mkdirSync(cache, { recursive: true });
	mkdirSync(binariesDir, { recursive: true });

	const cached = path.join(cache, asset.name);
	if (existsSync(cached)) {
		try {
			verifySha256(cached, asset.sha256);
		} catch {
			rmSync(cached, { force: true });
		}
	}
	if (!existsSync(cached)) {
		await downloadTo(asset.url, cached);
		try {
			verifySha256(cached, asset.sha256);
		} catch (error) {
			rmSync(cached, { force: true });
			throw error;
		}
	}

	const tmpDest = `${dest}.tmp`;
	rmSync(tmpDest, { force: true });
	try {
		if (asset.archive) {
			extractZipMember(cached, asset.executable, tmpDest);
		} else {
			copyFileSync(cached, tmpDest);
			verifySha256(tmpDest, asset.sha256);
		}
		if (platform !== "win32") {
			chmodSync(tmpDest, 0o755);
		}
		renameSync(tmpDest, dest);
	} catch (error) {
		rmSync(tmpDest, { force: true });
		throw error;
	}

	return dest;
}

export async function installHostSidecar() {
	const dest = await installSidecar();
	console.log(`herdr sidecar ready: ${dest}`);
	return dest;
}

function isMain() {
	const entry = argv[1];
	if (!entry) {
		return false;
	}
	return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isMain()) {
	const args = argv.slice(2);
	let target;
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] === "--target") {
			target = args[i + 1];
			i += 1;
		} else if (args[i] === "--help") {
			console.log(
				"Usage: bun ./scripts/herdr-sidecar.mjs [--target <rustc-triple>]",
			);
			exit(0);
		} else {
			throw new Error(`unknown argument: ${args[i]}`);
		}
	}
	await installSidecar({ target, binariesDir: defaultBinariesDir() }).then(
		(dest) => {
			console.log(`herdr sidecar ready: ${dest}`);
		},
	);
}
