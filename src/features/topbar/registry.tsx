import { IconButton } from "@chakra-ui/react";
import { SiGit, SiGithub, SiVscodium } from "@icons-pack/react-simple-icons";
import { Command } from "@tauri-apps/plugin-shell";
import * as m from "@/paraglide/messages.js";
import type { ControlDefinition, ControlId } from "./types";

const definitions: ControlDefinition[] = [
	{
		id: "github-desktop",
		label: () => m.topbarGithubDesktop(),
		icon: SiGithub,
		optionFields: [],
		render: ({ profile }) => (
			<IconButton
				aria-label="Open in GitHub Desktop"
				size="xs"
				variant="subtle"
				onClick={() =>
					Command.create("github", [
						profile.worktree_path,
					]).execute()
				}
			>
				<SiGithub size={14} />
			</IconButton>
		),
	},
	{
		id: "vscode",
		label: () => m.topbarVscode(),
		icon: SiVscodium,
		optionFields: [],
		render: ({ profile }) => (
			<IconButton
				aria-label="Open in VS Code"
				size="xs"
				variant="subtle"
				onClick={() =>
					Command.create("code", [
						profile.worktree_path,
					]).execute()
				}
			>
				<SiVscodium size={14} />
			</IconButton>
		),
	},
	{
		id: "git-diff",
		label: () => m.topbarGitDiff(),
		icon: SiGit,
		optionFields: [],
		render: ({ options }) => (
			<IconButton
				aria-label="Git diff"
				size="xs"
				variant="subtle"
				onClick={options.__onOpenDiff as () => void}
			>
				<SiGit size={14} />
			</IconButton>
		),
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);
