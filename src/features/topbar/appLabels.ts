import * as m from "@/paraglide/messages.js";
import type { LaunchAppId } from "./types";

export const launchAppLabels: Record<LaunchAppId, () => string> = {
	"github-desktop": () => m.topbarGithubDesktop(),
	vscode: () => m.topbarVscode(),
	windsurf: () => m.topbarWindsurf(),
	cursor: () => m.topbarCursor(),
	zed: () => m.topbarZed(),
	"sublime-text": () => m.topbarSublimeText(),
	ghostty: () => m.topbarGhostty(),
	iterm2: () => m.topbarIterm2(),
	kitty: () => m.topbarKitty(),
	warp: () => m.topbarWarp(),
};
