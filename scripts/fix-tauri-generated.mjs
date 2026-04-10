import { readFile, writeFile } from "node:fs/promises";

const replacements = [
	{
		path: new URL("../src/generated/commands.ts", import.meta.url),
		pairs: [
			[
				"import { invoke, Channel } from '@tauri-apps/api/core';",
				"import { invoke } from '@tauri-apps/api/core';",
			],
		],
	},
	{
		path: new URL("../src/generated/events.ts", import.meta.url),
		pairs: [
			[
				"import { listen, type UnlistenFn, type Event } from '@tauri-apps/api/event';",
				"import { listen, type UnlistenFn } from '@tauri-apps/api/event';",
			],
			["import * as types from './types';\n", ""],
		],
	},
];

for (const { path, pairs } of replacements) {
	let content = await readFile(path, "utf8");
	for (const [from, to] of pairs) {
		content = content.replace(from, to);
	}
	await writeFile(path, content);
}
