import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect } from "chai";
import { after, afterEach, before, describe, it } from "mocha";
import { Builder, By, Capabilities, Key } from "selenium-webdriver";

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
let runtimeRoot;
let fixtureDir;

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
		runtimeRoot = await fsp.mkdtemp(
			path.join(os.tmpdir(), "2code-smoke-"),
		);
		await prepareRuntimeDirs();
		fixtureDir = await createGitFixture();

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

		await driver.manage().setTimeouts({ script: 60_000 });
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

		const nav = await waitForElement(
			"nav[aria-label], [role='navigation'][aria-label]",
		);
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

	it("renames a project through the desktop UI and persists the mutation", async function () {
		this.timeout(90_000);

		const initialName = "smoke project before";
		const renamedName = "smoke project after";
		const project = await invokeTauri("create_project_from_folder", {
			name: initialName,
			folder: fixtureDir,
		});

		expect(project).to.include({
			name: initialName,
			folder: fixtureDir,
		});

		await reloadApp();
		const projectItem = await waitForProjectItem(project.id);
		await waitForBodyText((text) => text.includes(initialName));

		await driver.actions({ async: true }).contextClick(projectItem).perform();
		const renameItem = await waitForElement(
			"[data-testid='project-menu-rename']",
		);
		await renameItem.click();

		const renameInput = await waitForElement("[data-rename-input]");
		await renameInput.clear();
		await renameInput.sendKeys(renamedName, Key.ENTER);

		await waitForBodyText(
			(text) => text.includes(renamedName) && !text.includes(initialName),
		);

		const projects = await invokeTauri("list_projects");
		const persisted = projects.find((item) => item.id === project.id);
		expect(persisted).to.include({
			id: project.id,
			name: renamedName,
		});
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
		env: {
			...process.env,
			HOME: path.join(runtimeRoot, "home"),
			XDG_CACHE_HOME: path.join(runtimeRoot, "cache"),
			XDG_CONFIG_HOME: path.join(runtimeRoot, "config"),
			XDG_DATA_HOME: path.join(runtimeRoot, "data"),
			TMPDIR: path.join(runtimeRoot, "tmp"),
		},
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
	await waitForElement("body");
	return driver.executeScript(
		"return document.body?.innerText || document.body?.textContent || '';",
	);
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

async function reloadApp() {
	await driver.navigate().refresh();
	await waitForPageReady();
}

async function waitForProjectItem(projectId, timeoutMs = 60_000) {
	return waitForElement(
		`[data-testid='project-sidebar-item'][data-project-id='${cssString(projectId)}']`,
		timeoutMs,
	);
}

async function invokeTauri(command, args = {}) {
	const result = await driver.executeAsyncScript(
		`
		const command = arguments[0];
		const args = arguments[1] ?? {};
		const done = arguments[arguments.length - 1];
		const invoke =
			window.__TAURI_INTERNALS__?.invoke
			?? window.__TAURI__?.core?.invoke;

		if (typeof invoke !== "function") {
			done({ ok: false, error: "Tauri invoke API not found" });
			return;
		}

		Promise.resolve(invoke(command, args))
			.then((value) => done({ ok: true, value }))
			.catch((error) => {
				done({
					ok: false,
					error: error?.message ?? String(error),
				});
			});
		`,
		command,
		args,
	);

	if (!result?.ok) {
		throw new Error(`Tauri command failed: ${command}: ${result?.error}`);
	}

	return result.value;
}

function isTransientNavigationError(error) {
	const name = error?.name ?? "";
	const message = error?.message ?? "";

	return /NoSuchFrameError|StaleElementReferenceError/i.test(name)
		|| /unload event|stale element/i.test(message);
}

async function prepareRuntimeDirs() {
	await Promise.all(
		["home", "cache", "config", "data", "tmp"].map((name) =>
			fsp.mkdir(path.join(runtimeRoot, name), { recursive: true }),
		),
	);
}

async function createGitFixture() {
	const fixture = path.join(runtimeRoot, "fixture-repo");
	await fsp.mkdir(fixture, { recursive: true });
	await fsp.writeFile(
		path.join(fixture, "README.md"),
		"# 2code smoke fixture\n",
		"utf8",
	);

	runOrThrow("git", ["init", "."], { cwd: fixture });
	runOrThrow("git", ["config", "user.email", "smoke@example.invalid"], {
		cwd: fixture,
	});
	runOrThrow("git", ["config", "user.name", "2code Smoke"], {
		cwd: fixture,
	});
	runOrThrow("git", ["add", "README.md"], { cwd: fixture });
	runOrThrow("git", ["commit", "-m", "initial smoke fixture"], {
		cwd: fixture,
	});

	return fixture;
}

function runOrThrow(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd ?? repoRoot,
		stdio: "inherit",
		shell: process.platform === "win32",
		env: {
			...process.env,
			CI: process.env.CI ?? "1",
			...options.env,
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

function cssString(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

	if (runtimeRoot) {
		await fsp.rm(runtimeRoot, {
			recursive: true,
			force: true,
			maxRetries: 5,
			retryDelay: 200,
		});
		runtimeRoot = undefined;
	}
}
