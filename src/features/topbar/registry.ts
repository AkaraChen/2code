import {
	SiCursor,
	SiGhostty,
	SiGithub,
	SiIterm2,
	SiSublimetext,
	SiWarp,
	SiWindsurf,
	SiZedindustries,
} from "@icons-pack/react-simple-icons";
import {
	PiFolderOpenFill,
	PiGitDiffFill,
	PiGitPullRequestFill,
	PiTerminalWindowFill,
} from "react-icons/pi";
import { VscVscode } from "react-icons/vsc";
import * as m from "@/paraglide/messages.js";
import {
	CursorControl,
	GhosttyControl,
	GitDiffControl,
	GitPullRequestStatusControl,
	GithubDesktopControl,
	Iterm2Control,
	KittyControl,
	RevealInFinderControl,
	SublimeTextControl,
	VscodeControl,
	WarpControl,
	WindsurfControl,
	ZedControl,
} from "./controls";
import type { ControlDefinition, ControlId, LaunchAppControlId } from "./types";

const definitions: ControlDefinition[] = [
	{
		id: "github-desktop",
		kind: "app",
		label: () => m.topbarGithubDesktop(),
		icon: SiGithub,
		optionFields: [],
		component: GithubDesktopControl,
	},
	{
		id: "vscode",
		kind: "app",
		label: () => m.topbarVscode(),
		icon: VscVscode,
		optionFields: [],
		component: VscodeControl,
	},
	{
		id: "windsurf",
		kind: "app",
		label: () => m.topbarWindsurf(),
		icon: SiWindsurf,
		optionFields: [],
		component: WindsurfControl,
	},
	{
		id: "cursor",
		kind: "app",
		label: () => m.topbarCursor(),
		icon: SiCursor,
		optionFields: [],
		component: CursorControl,
	},
	{
		id: "zed",
		kind: "app",
		label: () => m.topbarZed(),
		icon: SiZedindustries,
		optionFields: [],
		component: ZedControl,
	},
	{
		id: "sublime-text",
		kind: "app",
		label: () => m.topbarSublimeText(),
		icon: SiSublimetext,
		optionFields: [],
		component: SublimeTextControl,
	},
	{
		id: "ghostty",
		kind: "app",
		label: () => m.topbarGhostty(),
		icon: SiGhostty,
		optionFields: [],
		component: GhosttyControl,
	},
	{
		id: "iterm2",
		kind: "app",
		label: () => m.topbarIterm2(),
		icon: SiIterm2,
		optionFields: [],
		component: Iterm2Control,
	},
	{
		id: "kitty",
		kind: "app",
		label: () => m.topbarKitty(),
		icon: PiTerminalWindowFill,
		optionFields: [],
		component: KittyControl,
	},
	{
		id: "warp",
		kind: "app",
		label: () => m.topbarWarp(),
		icon: SiWarp,
		optionFields: [],
		component: WarpControl,
	},
	{
		id: "git-diff",
		kind: "static",
		label: () => m.topbarGitDiff(),
		icon: PiGitDiffFill,
		optionFields: [],
		component: GitDiffControl,
	},
	{
		id: "pr-status",
		kind: "static",
		label: () => m.topbarPrStatus(),
		icon: PiGitPullRequestFill,
		optionFields: [],
		component: GitPullRequestStatusControl,
	},
	{
		id: "reveal-in-finder",
		kind: "static",
		label: () => m.revealInFinder(),
		icon: PiFolderOpenFill,
		optionFields: [],
		component: RevealInFinderControl,
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);

export function getSupportedControlIds(
	supportedAppIds: readonly LaunchAppControlId[],
) {
	const supportedAppIdSet = new Set(supportedAppIds);
	const supportedControlIds: ControlId[] = [];
	for (const def of definitions) {
		if (
			def.kind === "static" ||
			supportedAppIdSet.has(def.id as LaunchAppControlId)
		) {
			supportedControlIds.push(def.id);
		}
	}
	return supportedControlIds;
}
