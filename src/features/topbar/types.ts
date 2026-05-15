import type { ComponentType } from "react";
import type { Profile } from "@/generated";

export const launchAppControlIds = [
	"github-desktop",
	"vscode",
	"windsurf",
	"cursor",
	"zed",
	"sublime-text",
	"ghostty",
	"iterm2",
	"kitty",
	"warp",
] as const;

export const staticControlIds = [
	"git-diff",
	"pr-status",
	"reveal-in-finder",
] as const;

export type LaunchAppControlId = (typeof launchAppControlIds)[number];
export type StaticControlId = (typeof staticControlIds)[number];
export type ControlId = LaunchAppControlId | StaticControlId;

const launchAppControlIdSet = new Set<string>(launchAppControlIds);

export function isLaunchAppControlId(id: string): id is LaunchAppControlId {
	return launchAppControlIdSet.has(id);
}

export interface ControlOptionField {
	key: string;
	label: () => string;
	type: "text" | "number" | "select";
	defaultValue: string | number;
	placeholder?: string;
}

export interface ControlProps {
	profile: Profile;
	isActive: boolean;
	options: Record<string, unknown>;
}

export interface ControlDefinition {
	id: ControlId;
	kind: "app" | "static";
	label: () => string;
	icon: ComponentType<{ size?: number | string }>;
	optionFields: ControlOptionField[];
	component: ComponentType<ControlProps>;
}
