import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect } from "chai";
import { after, afterEach, before, describe, it } from "mocha";
import { Builder, By, Capabilities } from "selenium-webdriver";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const e2eRoot = path.resolve(testDir, "..");
const repoRoot = path.resolve(e2eRoot, "..");
const artifactsDir = path.join(e2eRoot, "artifacts");
const cargoHome =
	process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo");
const tauriDriverBinary = path.join(
	cargoHome,
	"bin",
	process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver",
);
const appBinary = path.join(
	repoRoot,
	"src-tauri",
	"target",
	"debug",
	process.platform === "win32" ? "code.exe" : "code",
);

let driver;
let tauriDriver;
let tauriDriverClosed = false;

describe("tauri smoke", () => {
	before(async function () {
		if (process.platform === "darwin") {
			console.warn(
				"Skipping desktop smoke test on macOS: Tauri does not expose a desktop WebDriver client there.",
			);
			this.skip();
			return;
		}

		this.timeout(15 * 60 * 1000);

		await fsp.mkdir(artifactsDir, { recursive: true });
		assertExecutableExists(
			tauriDriverBinary,
			"Install it first with `cargo install tauri-driver`.",
		);

		buildAppForSmoke();
		assertExecutableExists(
			appBinary,
			`Expected built app binary at ${appBinary}.`,
		);

		startTauriDriver();
		await waitForWebDriverServer();

		const capabilities = new Capabilities();
		capabilities.setBrowserName("wry");
		capabilities.set("tauri:options", { application: appBinary });

		driver = await new Builder()
			.usingServer("http://127.0.0.1:4444/")
			.withCapabilities(capabilities)
			.build();

		await waitForPageReady();
	});

	afterEach(async function () {
		if (!driver || this.currentTest?.state !== "failed") {
			return;
		}

		const basename = sanitize(this.currentTest.title);
		const screenshotPath = path.join(artifactsDir, `${basename}.png`);
		const pageSourcePath = path.join(artifactsDir, `${basename}.html`);

		try {
			const pageSource = await driver.getPageSource();
			await fsp.writeFile(pageSourcePath, pageSource, "utf8");

			const screenshot = await driver.takeScreenshot();
			await fsp.writeFile(screenshotPath, screenshot, "base64");
			console.error(
				`Saved smoke-test failure diagnostics to ${screenshotPath} and ${pageSourcePath}`,
			);
		} catch (error) {
			console.error("Failed to capture smoke-test screenshot:", error);
		}
	});

	after(async () => {
		await closeResources();
	});

	it("launches the desktop shell and renders a non-empty main layout", async function () {
		this.timeout(60_000);

		const nav = await waitForElement("nav[aria-label]");
		const main = await waitForElement("main");
		const addProjectButton = await waitForElement("#add-project-button");

		const bodyText = await waitForBodyText((text) => text.trim().length > 20);

		expect(await nav.isDisplayed()).to.equal(true);
		expect(await main.isDisplayed()).to.equal(true);
		expect(await addProjectButton.isDisplayed()).to.equal(true);
		expect(bodyText).to.match(
			/No projects yet|暂无项目|Create your first project|从侧边栏创建|Projects|项目|Settings|设置/,
		);
	});
});

function buildAppForSmoke() {
	runOrThrow("bun", ["tauri", "build", "--debug", "--no-bundle"]);
}

function startTauriDriver() {
	const args = [];
	if (process.env.TAURI_SMOKE_NATIVE_DRIVER) {
		args.push("--native-driver", process.env.TAURI_SMOKE_NATIVE_DRIVER);
	}

	tauriDriver = spawn(tauriDriverBinary, args, {
		stdio: ["ignore", "pipe", "pipe"],
	});

	tauriDriver.stdout.on("data", (chunk) => {
		process.stdout.write(chunk);
	});
	tauriDriver.stderr.on("data", (chunk) => {
		process.stderr.write(chunk);
	});
	tauriDriver.on("error", (error) => {
		throw new Error(`tauri-driver failed to start: ${error.message}`);
	});
	tauriDriver.on("exit", (code) => {
		if (!tauriDriverClosed && code !== 0) {
			throw new Error(`tauri-driver exited unexpectedly with code ${code}`);
		}
	});
}

async function waitForWebDriverServer() {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			const response = await fetch("http://127.0.0.1:4444/status");
			if (response.ok) {
				return;
			}
		} catch {}

		await sleep(500);
	}

	throw new Error("Timed out waiting for tauri-driver to accept connections.");
}

async function readBodyText() {
	const body = await waitForElement("body");
	return body.getText();
}

async function waitForPageReady(timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;

	while (Date.now() < deadline) {
		try {
			const readyState = await driver.executeScript(
				"return document.readyState",
			);
			if (readyState === "complete") {
				await waitForElement("body", 5_000);
				return;
			}
		} catch (error) {
			if (!isTransientNavigationError(error)) {
				throw error;
			}
			lastError = error;
		}

		await sleep(500);
	}

	throw lastError ?? new Error("Timed out waiting for the Tauri page to load.");
}

async function waitForElement(selector, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;

	while (Date.now() < deadline) {
		try {
			const elements = await driver.findElements(By.css(selector));
			if (elements.length > 0) {
				return elements[0];
			}
		} catch (error) {
			if (!isTransientNavigationError(error)) {
				throw error;
			}
			lastError = error;
		}

		await sleep(500);
	}

	throw (
		lastError ?? new Error(`Timed out waiting for element matching ${selector}.`)
	);
}

async function waitForBodyText(predicate, timeoutMs = 60_000) {
	const deadline = Date.now() + timeoutMs;
	let lastError;

	while (Date.now() < deadline) {
		try {
			const text = await readBodyText();
			if (predicate(text)) {
				return text;
			}
		} catch (error) {
			if (!isTransientNavigationError(error)) {
				throw error;
			}
			lastError = error;
		}

		await sleep(500);
	}

	throw lastError ?? new Error("Timed out waiting for non-empty body text.");
}

function isTransientNavigationError(error) {
	const name = error?.name ?? "";
	const message = error?.message ?? "";

	return /NoSuchFrameError|StaleElementReferenceError/i.test(name)
		|| /unload event|stale element/i.test(message);
}

function runOrThrow(command, args) {
	const result = spawnSync(command, args, {
		cwd: repoRoot,
		stdio: "inherit",
		shell: process.platform === "win32",
		env: {
			...process.env,
			CI: process.env.CI ?? "1",
		},
	});

	if (result.status !== 0) {
		throw new Error(`Command failed: ${command} ${args.join(" ")}`);
	}
}

function assertExecutableExists(filepath, hint) {
	if (!fs.existsSync(filepath)) {
		throw new Error(`Missing required binary: ${filepath}\n${hint}`);
	}
}

function sanitize(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeResources() {
	if (driver) {
		try {
			await driver.quit();
		} catch {}
		driver = undefined;
	}

	if (tauriDriver) {
		tauriDriverClosed = true;
		tauriDriver.kill();
		tauriDriver = undefined;
	}
}
