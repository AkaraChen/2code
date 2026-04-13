import { spawnSync } from "node:child_process";
import {
	cp,
	mkdir,
	mkdtemp,
	readdir,
	rm,
	stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

const FILE_ICONS_DIRNAME = "file-icons";
const VSCODE_ICONS_REPO_URL = "https://github.com/vscode-icons/vscode-icons.git";
const VSCODE_ICONS_SPARSE_PATH = "icons";

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
	if (await directoryHasFiles(targetDir)) {
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

		await rm(targetDir, { recursive: true, force: true });
		await cp(path.join(cloneDir, VSCODE_ICONS_SPARSE_PATH), targetDir, {
			recursive: true,
		});

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
