import { readFile, writeFile } from "node:fs/promises";

const replacements = [
	{
		path: new URL("../src/generated/types.ts", import.meta.url),
		pairs: [
			[
				"export interface AgentStatusEvent {\n",
				"export type AgentStatus = \"running\" | \"waiting\" | \"idle\";\n\nexport interface AgentStatusEvent {\n",
			],
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
	{
		path: new URL("../src/generated/events.ts", import.meta.url),
		pairs: [
			[
				"import { listen, type UnlistenFn, type Event } from '@tauri-apps/api/event';",
				"import { listen, type UnlistenFn } from '@tauri-apps/api/event';",
			],
			["types.session_id", "unknown"],
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
