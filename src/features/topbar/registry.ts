import {
	SiCursor,
	SiGit,
	SiGithub,
	SiVscodium,
	SiWindsurf,
} from "@icons-pack/react-simple-icons";
import { RiFolderLine, RiGitPullRequestLine } from "react-icons/ri";
import * as m from "@/paraglide/messages.js";
import {
	CursorControl,
	GitDiffControl,
	GithubDesktopControl,
	GithubPrControl,
	RevealInFinderControl,
	VscodeControl,
	WindsurfControl,
} from "./controls";
import type { ControlDefinition, ControlId } from "./types";

const definitions: ControlDefinition[] = [
	{
		id: "github-desktop",
		label: () => m.topbarGithubDesktop(),
		icon: SiGithub,
		component: GithubDesktopControl,
	},
	{
		id: "vscode",
		label: () => m.topbarVscode(),
		icon: SiVscodium,
		component: VscodeControl,
	},
	{
		id: "windsurf",
		label: () => m.topbarWindsurf(),
		icon: SiWindsurf,
		component: WindsurfControl,
	},
	{
		id: "cursor",
		label: () => m.topbarCursor(),
		icon: SiCursor,
		component: CursorControl,
	},
	{
		id: "github-pr",
		label: () => m.topbarGithubPr(),
		icon: RiGitPullRequestLine,
		component: GithubPrControl,
	},
	{
		id: "git-diff",
		label: () => m.topbarGitDiff(),
		icon: SiGit,
		component: GitDiffControl,
	},
	{
		id: "reveal-in-finder",
		label: () => m.revealInFinder(),
		icon: RiFolderLine,
		component: RevealInFinderControl,
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);
