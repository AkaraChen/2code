import claudeIconUrl from "@lobehub/icons-static-svg/icons/claude-color.svg";
import clineIconUrl from "@lobehub/icons-static-svg/icons/cline.svg";
import codexIconUrl from "@lobehub/icons-static-svg/icons/codex-color.svg";
import geminiIconUrl from "@lobehub/icons-static-svg/icons/gemini-color.svg";
import kimiIconUrl from "@lobehub/icons-static-svg/icons/kimi-color.svg";
import openClawIconUrl from "@lobehub/icons-static-svg/icons/openclaw-color.svg";
import opencodeIconUrl from "@lobehub/icons-static-svg/icons/opencode.svg";
import qoderIconUrl from "@lobehub/icons-static-svg/icons/qoder-color.svg";
import type { ReactNode } from "react";
import { FiTerminal } from "react-icons/fi";

const AGENT_TAB_ICONS: { keyword: string; iconUrl: string }[] = [
	{ keyword: "claude", iconUrl: claudeIconUrl },
	{ keyword: "codex", iconUrl: codexIconUrl },
	{ keyword: "gemini", iconUrl: geminiIconUrl },
	{ keyword: "kimi", iconUrl: kimiIconUrl },
	{ keyword: "cline", iconUrl: clineIconUrl },
	{ keyword: "openclaw", iconUrl: openClawIconUrl },
	{ keyword: "opencode", iconUrl: opencodeIconUrl },
	{ keyword: "qoder", iconUrl: qoderIconUrl },
];

const terminalTabIconCache = new Map<string, ReactNode>();

export function getTerminalTabIcon(title: string) {
	const cachedIcon = terminalTabIconCache.get(title);
	if (cachedIcon) return cachedIcon;

	const lowerTitle = title.toLowerCase();
	const match = AGENT_TAB_ICONS.find(({ keyword }) =>
		lowerTitle.includes(keyword),
	);

	const icon = match ? (
		<img
			alt=""
			aria-hidden="true"
			draggable={false}
			src={match.iconUrl}
			style={{ width: 14, height: 14, flexShrink: 0 }}
		/>
	) : (
		<FiTerminal size={14} />
	);
	terminalTabIconCache.set(title, icon);
	return icon;
}
