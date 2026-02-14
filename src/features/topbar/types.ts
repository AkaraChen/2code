import type { ComponentType } from "react";
import type { Profile } from "@/generated";

export type ControlId =
	| "github-desktop"
	| "vscode"
	| "windsurf"
	| "cursor"
	| "git-diff";

export interface ControlOptionField {
	key: string;
	label: () => string;
	type: "text" | "number" | "select";
	defaultValue: string | number;
	placeholder?: string;
}

export interface ControlProps {
	profile: Profile;
	options: Record<string, unknown>;
}

export interface ControlDefinition {
	id: ControlId;
	label: () => string;
	icon: ComponentType<{ size?: number | string }>;
	optionFields: ControlOptionField[];
	component: ComponentType<ControlProps>;
}
