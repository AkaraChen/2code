import { IconButton, Portal, Tooltip } from "@chakra-ui/react";
import { SiCursor, SiGit, SiGithub, SiVscodium, SiWindsurf } from "@icons-pack/react-simple-icons";
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
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<IconButton
						aria-label={m.topbarGithubDesktop()}
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
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>
							{m.topbarGithubDesktop()}
						</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
		),
	},
	{
		id: "vscode",
		label: () => m.topbarVscode(),
		icon: SiVscodium,
		optionFields: [],
		render: ({ profile }) => (
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<IconButton
						aria-label={m.topbarVscode()}
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
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>
							{m.topbarVscode()}
						</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
		),
	},
	{
		id: "windsurf",
		label: () => m.topbarWindsurf(),
		icon: SiWindsurf,
		optionFields: [],
		render: ({ profile }) => (
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<IconButton
						aria-label={m.topbarWindsurf()}
						size="xs"
						variant="subtle"
						onClick={() =>
							Command.create("windsurf", [
								profile.worktree_path,
							]).execute()
						}
					>
						<SiWindsurf size={14} />
					</IconButton>
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>
							{m.topbarWindsurf()}
						</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
		),
	},
	{
		id: "cursor",
		label: () => m.topbarCursor(),
		icon: SiCursor,
		optionFields: [],
		render: ({ profile }) => (
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<IconButton
						aria-label={m.topbarCursor()}
						size="xs"
						variant="subtle"
						onClick={() =>
							Command.create("cursor", [
								profile.worktree_path,
							]).execute()
						}
					>
						<SiCursor size={14} />
					</IconButton>
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>
							{m.topbarCursor()}
						</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
		),
	},
	{
		id: "git-diff",
		label: () => m.topbarGitDiff(),
		icon: SiGit,
		optionFields: [],
		render: ({ options }) => (
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<IconButton
						aria-label={m.topbarGitDiff()}
						size="xs"
						variant="subtle"
						onClick={options.__onOpenDiff as () => void}
					>
						<SiGit size={14} />
					</IconButton>
				</Tooltip.Trigger>
				<Portal>
					<Tooltip.Positioner>
						<Tooltip.Content>
							{m.topbarGitDiff()}
						</Tooltip.Content>
					</Tooltip.Positioner>
				</Portal>
			</Tooltip.Root>
		),
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);
