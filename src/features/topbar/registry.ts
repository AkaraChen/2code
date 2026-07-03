import {
	CodeIcon,
	GithubLogoIcon,
	GitPullRequestIcon,
	TerminalWindowIcon,
} from "@phosphor-icons/react";
import * as m from "@/paraglide/messages.js";
import {
	EditorControl,
	GithubDesktopControl,
	GitPullRequestStatusControl,
	TerminalControl,
} from "./controls";
import {
	type ControlDefinition,
	type ControlId,
	editorAppIds,
	type LaunchAppId,
	terminalAppIds,
} from "./types";

const definitions: ControlDefinition[] = [
	{
		id: "github-desktop",
		kind: "app",
		label: () => m.topbarGithubDesktop(),
		icon: GithubLogoIcon,
		optionFields: [],
		component: GithubDesktopControl,
	},
	{
		id: "editor",
		kind: "app",
		label: () => m.topbarEditor(),
		icon: CodeIcon,
		optionFields: [],
		component: EditorControl,
	},
	{
		id: "terminal",
		kind: "app",
		label: () => m.topbarTerminal(),
		icon: TerminalWindowIcon,
		optionFields: [],
		component: TerminalControl,
	},
	{
		id: "pr-status",
		kind: "static",
		label: () => m.topbarPrStatus(),
		icon: GitPullRequestIcon,
		optionFields: [],
		component: GitPullRequestStatusControl,
	},
];

export const controlRegistry = new Map<ControlId, ControlDefinition>(
	definitions.map((d) => [d.id, d]),
);

export const allControlIds: ControlId[] = definitions.map((d) => d.id);

export function getSupportedControlIds(
	supportedAppIds: readonly LaunchAppId[],
) {
	const supported = new Set<LaunchAppId>(supportedAppIds);
	const isControlSupported = (id: ControlId) => {
		switch (id) {
			case "github-desktop":
				return supported.has("github-desktop");
			case "editor":
				return editorAppIds.some((app) => supported.has(app));
			case "terminal":
				return terminalAppIds.some((app) => supported.has(app));
			default:
				return true;
		}
	};
	return definitions
		.filter((def) => isControlSupported(def.id))
		.map((def) => def.id);
}
