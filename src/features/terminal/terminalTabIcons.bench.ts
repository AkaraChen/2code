import { bench } from "vitest";
import { AGENT_TAB_ICONS, getTerminalTabIconUrl } from "./terminalTabIcons";

const TITLES = [
	"Claude Code",
	"codex shell",
	"Gemini session",
	"Kimi workspace",
	"pnpm dev",
	"OpenCode review",
	"Qoder agent",
	"zsh",
];

function getTerminalTabIconUrlWithFind(title: string) {
	const lowerTitle = title.toLowerCase();
	const match = AGENT_TAB_ICONS.find(({ keyword }) =>
		lowerTitle.includes(keyword),
	);
	return match?.iconUrl ?? null;
}

bench("find terminal tab icon", () => {
	let count = 0;
	for (const title of TITLES) {
		if (getTerminalTabIconUrlWithFind(title)) count += 1;
	}
	if (count === 0) throw new Error("unreachable");
});

bench("loop terminal tab icon", () => {
	let count = 0;
	for (const title of TITLES) {
		if (getTerminalTabIconUrl(title)) count += 1;
	}
	if (count === 0) throw new Error("unreachable");
});
