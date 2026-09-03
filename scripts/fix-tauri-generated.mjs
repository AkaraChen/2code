import { readFile, writeFile } from "node:fs/promises";

const replacements = [
	{
		path: new URL("../legacy/web/src/generated/types.ts", import.meta.url),
		pairs: [
			["onOutput: Channel<unknown>;", "onOutput: Channel<ArrayBuffer>;"],
		],
	},
	{
		path: new URL("../legacy/web/src/generated/commands.ts", import.meta.url),
		pairs: [
			[
				"import { invoke, Channel } from '@tauri-apps/api/core';",
				"import { invoke } from '@tauri-apps/api/core';",
			],
		],
	},
];

for (const { path, pairs } of replacements) {
	let content = await readFile(path, "utf8");
	for (const [from, to] of pairs) {
		content = content.replaceAll(from, to);
	}
	content = `${content.trimEnd()}\n`;
	await writeFile(path, content);
}
