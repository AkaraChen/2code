import { SiCursor, SiGit, SiGithub, SiVscodium, SiWindsurf } from "@icons-pack/react-simple-icons";
import { FiFolder } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import {
	CursorControl,
	GithubDesktopControl,
	GitDiffControl,
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
		optionFields: [],
		component: GithubDesktopControl,
	},
	{
		id: "vscode",
		label: () => m.topbarVscode(),
		icon: SiVscodium,
		optionFields: [],
		component: VscodeControl,
	},
	{
		id: "windsurf",
		label: () => m.topbarWindsurf(),
		icon: SiWindsurf,
		optionFields: [],
		component: WindsurfControl,
	},
	{
		id: "cursor",
		label: () => m.topbarCursor(),
		icon: SiCursor,
		optionFields: [],
		component: CursorControl,
	},
	{
		id: "git-diff",
		label: () => m.topbarGitDiff(),
		icon: SiGit,
		optionFields: [],
		component: GitDiffControl,
	},
	{
		id: "reveal-in-finder",
		label: () => m.revealInFinder(),
		icon: FiFolder,
		optionFields: [],
		component: RevealInFinderControl,
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);
