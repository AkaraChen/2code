import { FiTerminal } from "react-icons/fi";
import { bench, describe } from "vitest";
import { getTerminalTabIcon } from "./terminalTabIcon";

const AGENT_TAB_ICONS = [
	{ keyword: "claude", iconUrl: "claude.svg" },
	{ keyword: "codex", iconUrl: "codex.svg" },
	{ keyword: "gemini", iconUrl: "gemini.svg" },
	{ keyword: "kimi", iconUrl: "kimi.svg" },
	{ keyword: "cline", iconUrl: "cline.svg" },
	{ keyword: "openclaw", iconUrl: "openclaw.svg" },
	{ keyword: "opencode", iconUrl: "opencode.svg" },
	{ keyword: "qoder", iconUrl: "qoder.svg" },
];
const titles = [
	"codex",
	"claude",
	"gemini worker",
	"shell",
	"npm run dev",
	"opencode",
	"qoder",
	"plain zsh",
];

function getTerminalTabIconUncached(title: string) {
	const lowerTitle = title.toLowerCase();
	const match = AGENT_TAB_ICONS.find(({ keyword }) =>
		lowerTitle.includes(keyword),
	);

	if (!match) return <FiTerminal size={14} />;

	return (
		<img
			alt=""
			aria-hidden="true"
			draggable={false}
			src={match.iconUrl}
			style={{ width: 14, height: 14, flexShrink: 0 }}
		/>
	);
}

describe("terminal tab icon lookup", () => {
	bench("cached icon lookup", () => {
		for (const title of titles) {
			getTerminalTabIcon(title);
		}
	});

	bench("uncached icon lookup", () => {
		for (const title of titles) {
			getTerminalTabIconUncached(title);
		}
	});
});
