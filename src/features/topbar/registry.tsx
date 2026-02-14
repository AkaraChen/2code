import { IconButton } from "@chakra-ui/react";
import { Command } from "@tauri-apps/plugin-shell";
import {
	RiCodeSSlashLine,
	RiGitPullRequestLine,
	RiGithubLine,
} from "react-icons/ri";
import * as m from "@/paraglide/messages.js";
import type { ControlDefinition, ControlId } from "./types";

const definitions: ControlDefinition[] = [
	{
		id: "github-desktop",
		label: () => m.topbarGithubDesktop(),
		icon: RiGithubLine,
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
				<RiGithubLine />
			</IconButton>
		),
	},
	{
		id: "vscode",
		label: () => m.topbarVscode(),
		icon: RiCodeSSlashLine,
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
				<RiCodeSSlashLine />
			</IconButton>
		),
	},
	{
		id: "git-diff",
		label: () => m.topbarGitDiff(),
		icon: RiGitPullRequestLine,
		optionFields: [],
		render: ({ options }) => (
			<IconButton
				aria-label="Git diff"
				size="xs"
				variant="subtle"
				onClick={options.__onOpenDiff as () => void}
			>
				<RiGitPullRequestLine />
			</IconButton>
		),
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);
