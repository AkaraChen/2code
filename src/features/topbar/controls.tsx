import { Button, HStack, Menu, Portal } from "@chakra-ui/react";
import {
	SiCursor,
	SiGhostty,
	SiGithub,
	SiIterm2,
	SiSublimetext,
	SiVscodium,
	SiWarp,
	SiWindsurf,
	SiZedindustries,
} from "@icons-pack/react-simple-icons";
import { Command } from "@tauri-apps/plugin-shell";
import type { ComponentType } from "react";
import { FiChevronDown, FiFolder, FiTerminal } from "react-icons/fi";
import * as m from "@/paraglide/messages.js";
import { useSupportedTopbarAppIds, useOpenTopbarApp } from "./hooks";
import type { ControlProps, LaunchAppControlId } from "./types";

interface AppMenuEntry {
	id: LaunchAppControlId;
	label: string;
	icon: ComponentType<{ size?: number | string }>;
}

function getAppMenuEntries(): AppMenuEntry[] {
	return [
		{ id: "github-desktop", label: m.topbarGithubDesktop(), icon: SiGithub },
		{ id: "vscode", label: m.topbarVscode(), icon: SiVscodium },
		{ id: "windsurf", label: m.topbarWindsurf(), icon: SiWindsurf },
		{ id: "cursor", label: m.topbarCursor(), icon: SiCursor },
		{ id: "zed", label: m.topbarZed(), icon: SiZedindustries },
		{ id: "sublime-text", label: m.topbarSublimeText(), icon: SiSublimetext },
		{ id: "ghostty", label: m.topbarGhostty(), icon: SiGhostty },
		{ id: "iterm2", label: m.topbarIterm2(), icon: SiIterm2 },
		{ id: "kitty", label: m.topbarKitty(), icon: FiTerminal },
		{ id: "warp", label: m.topbarWarp(), icon: SiWarp },
	];
}

export function OpenWithControl({ profile }: ControlProps) {
	const { data: supportedAppIds = [] } = useSupportedTopbarAppIds();
	const openApp = useOpenTopbarApp();
	const supportedSet = new Set(supportedAppIds);
	const entries = getAppMenuEntries().filter((entry) =>
		supportedSet.has(entry.id),
	);

	if (entries.length === 0) return null;

	return (
		<Menu.Root>
			<Menu.Trigger asChild>
				<Button size="xs" variant="subtle" gap="1.5">
					{m.topbarOpenWith()}
					<FiChevronDown />
				</Button>
			</Menu.Trigger>
			<Portal>
				<Menu.Positioner>
					<Menu.Content>
						{entries.map((entry) => {
							const Icon = entry.icon;
							return (
								<Menu.Item
									key={entry.id}
									value={entry.id}
									onClick={() =>
										openApp.mutate({
											appId: entry.id,
											path: profile.worktree_path,
										})
									}
								>
									<HStack gap="2">
										<Icon size={14} />
										<span>{entry.label}</span>
									</HStack>
								</Menu.Item>
							);
						})}
					</Menu.Content>
				</Menu.Positioner>
			</Portal>
		</Menu.Root>
	);
}

export function RevealInFinderControl({ profile }: ControlProps) {
	const handleReveal = async () => {
		const isMac = navigator.platform.toUpperCase().includes("MAC");
		const cmd = isMac ? "open" : "explorer";
		const args = isMac
			? ["-R", profile.worktree_path]
			: [profile.worktree_path];
		await Command.create(cmd, args).execute();
	};

	return (
		<Button size="xs" variant="subtle" gap="1.5" onClick={handleReveal}>
			<FiFolder />
			{m.revealInFinder()}
		</Button>
	);
}
