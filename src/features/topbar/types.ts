import type { ComponentType } from "react";
import type { Profile } from "@/generated";

export type ControlId =
	| "github-desktop"
	| "vscode"
	| "windsurf"
	| "cursor"
	| "github-pr"
	| "git-diff";

export interface ControlProps {
	profile: Profile;
}

export interface ControlDefinition {
	id: ControlId;
	label: () => string;
	icon: ComponentType<{ size?: number | string }>;
	component: ComponentType<ControlProps>;
}
