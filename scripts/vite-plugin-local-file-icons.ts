import { spawnSync } from "node:child_process";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	DEFAULT_FILE,
	DEFAULT_FOLDER,
	DEFAULT_FOLDER_OPENED,
	DEFAULT_ROOT,
	DEFAULT_ROOT_OPENED,
} from "vscode-icons-js";
import { FileExtensions1ToIcon } from "vscode-icons-js/dist/generated/FileExtensions1ToIcon.js";
import { FileExtensions2ToIcon } from "vscode-icons-js/dist/generated/FileExtensions2ToIcon.js";
import { FileNamesToIcon } from "vscode-icons-js/dist/generated/FileNamesToIcon.js";
import { FolderNamesToIcon } from "vscode-icons-js/dist/generated/FolderNamesToIcon.js";
import { LanguagesToIcon } from "vscode-icons-js/dist/generated/LanguagesToIcon.js";
import type { Plugin, ResolvedConfig } from "vite";

const FILE_ICONS_DIRNAME = "file-icons";
const VSCODE_ICONS_REPO_URL = "https://github.com/vscode-icons/vscode-icons.git";
const VSCODE_ICONS_SPARSE_PATH = "icons";
const SUBSET_MARKER_FILENAME = ".file-icons-manifest.json";
const SUBSET_VERSION = 1;
const SVG_SUFFIX_RE = /\.svg$/;

async function directoryHasFiles(dirPath: string) {
	try {
		const directoryStat = await stat(dirPath);
		if (!directoryStat.isDirectory()) {
			throw new Error(`${dirPath} exists but is not a directory`);
		}
		const entries = await readdir(dirPath);
		return entries.length > 0;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw error;
	}
}

async function isCurrentSubset(dirPath: string) {
	try {
		const raw = await readFile(
			path.join(dirPath, SUBSET_MARKER_FILENAME),
			"utf8",
		);
		return (JSON.parse(raw) as { version?: number }).version === SUBSET_VERSION;
	} catch {
		return false;
	}
}

export function computeReachableIconFilenames(): Set<string> {
	const names = new Set<string>([
		DEFAULT_FILE,
		DEFAULT_FOLDER,
		DEFAULT_FOLDER_OPENED,
		DEFAULT_ROOT,
		DEFAULT_ROOT_OPENED,
	]);

	for (const map of [
		FileExtensions1ToIcon,
		FileExtensions2ToIcon,
		FileNamesToIcon,
		LanguagesToIcon,
	]) {
		for (const icon of Object.values(map)) {
			names.add(icon);
		}
	}

	for (const icon of Object.values(FolderNamesToIcon)) {
		names.add(icon);
		names.add(icon.replace(SVG_SUFFIX_RE, "_opened.svg"));
	}

	return names;
}

function runGit(args: string[], cwd: string) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
	});

	if (result.status === 0) {
		return;
	}

	if (result.error) {
		throw result.error;
	}

	const stderr = result.stderr.trim();
	throw new Error(stderr || `git ${args.join(" ")} failed`);
}

async function ensureLocalFileIcons(config: ResolvedConfig) {
	const targetDir = path.resolve(config.publicDir, FILE_ICONS_DIRNAME);
	if (
		(await directoryHasFiles(targetDir)) &&
		(await isCurrentSubset(targetDir))
	) {
		return;
	}

	config.logger.info(
		`[file-icons] ${path.relative(config.root, targetDir)} missing, cloning vscode-icons/icons`,
		{ clear: false },
	);

	const cloneDir = await mkdtemp(
		path.join(os.tmpdir(), "2code-vscode-icons-"),
	);

	try {
		await mkdir(path.dirname(targetDir), { recursive: true });

		runGit(
			[
				"clone",
				"--depth=1",
				"--filter=blob:none",
				"--sparse",
				VSCODE_ICONS_REPO_URL,
				cloneDir,
			],
			config.root,
		);
		runGit(
			["-C", cloneDir, "sparse-checkout", "set", VSCODE_ICONS_SPARSE_PATH],
			config.root,
		);

		const sourceDir = path.join(cloneDir, VSCODE_ICONS_SPARSE_PATH);
		const reachable = computeReachableIconFilenames();
		const available = new Set(await readdir(sourceDir));

		await rm(targetDir, { recursive: true, force: true });
		await mkdir(targetDir, { recursive: true });

		const aliased: string[] = [];
		for (const name of reachable) {
			if (available.has(name)) {
				await copyFile(path.join(sourceDir, name), path.join(targetDir, name));
				continue;
			}

			aliased.push(name);
			const fallback = name.startsWith("folder_type_")
				? name.endsWith("_opened.svg")
					? DEFAULT_FOLDER_OPENED
					: DEFAULT_FOLDER
				: DEFAULT_FILE;
			await copyFile(path.join(sourceDir, fallback), path.join(targetDir, name));
			config.logger.warn(
				`[file-icons] ${name} is mapped by vscode-icons-js but missing from the vscode-icons clone; aliased to ${fallback}`,
			);
		}

		await writeFile(
			path.join(targetDir, SUBSET_MARKER_FILENAME),
			JSON.stringify(
				{ version: SUBSET_VERSION, files: reachable.size, aliased },
				null,
				"\t",
			),
		);

		config.logger.info(
			`[file-icons] installed local icons into ${path.relative(config.root, targetDir)}`,
			{ clear: false },
		);
	} finally {
		await rm(cloneDir, { recursive: true, force: true });
	}
}

export function localFileIconsPlugin(): Plugin {
	let pendingEnsure: Promise<void> | null = null;

	return {
		name: "local-file-icons",
		async configResolved(config) {
			pendingEnsure ??= ensureLocalFileIcons(config);
			await pendingEnsure;
		},
	};
}
