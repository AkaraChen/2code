import { readFile, writeFile } from "node:fs/promises";

const replacements = [
	{
		path: new URL("../src/generated/types.ts", import.meta.url),
		pairs: [
			["onOutput: Channel<unknown>;", "onOutput: Channel<ArrayBuffer>;"],
		],
	},
	{
		path: new URL("../src/generated/commands.ts", import.meta.url),
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
	if (
		path.pathname.endsWith("/types.ts")
		&& !content.includes("export type RawBytesResponse")
	) {
		content = content.replace(
			"import type { Channel } from '@tauri-apps/api/core';\n",
			"import type { Channel } from '@tauri-apps/api/core';\n\nexport type RawBytesResponse = ArrayBuffer;\n",
		);
	}
	content = `${content.trimEnd()}\n`;
	await writeFile(path, content);
}
