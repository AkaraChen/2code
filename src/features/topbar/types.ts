import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import type { Profile } from "@/generated";

export type ControlId = "github-desktop" | "vscode" | "git-diff";

export interface ControlOptionField {
	key: string;
	label: () => string;
	type: "text" | "number" | "select";
	defaultValue: string | number;
	placeholder?: string;
}

export interface ControlDefinition {
	id: ControlId;
	label: () => string;
	icon: IconType;
	optionFields: ControlOptionField[];
	render: (ctx: {
		profile: Profile;
		options: Record<string, unknown>;
	}) => ReactNode;
}
