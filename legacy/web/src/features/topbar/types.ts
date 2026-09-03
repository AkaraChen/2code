import type { ComponentType } from "react";
import type { Profile } from "@/generated";

export const editorAppIds = [
	"vscode",
	"windsurf",
	"cursor",
	"zed",
	"sublime-text",
] as const;

export const terminalAppIds = ["ghostty", "iterm2", "kitty", "warp"] as const;

export const launchAppIds = [
	"github-desktop",
	...editorAppIds,
	...terminalAppIds,
] as const;

export type EditorAppId = (typeof editorAppIds)[number];
export type TerminalAppId = (typeof terminalAppIds)[number];
export type LaunchAppId = (typeof launchAppIds)[number];

export function isLaunchAppId(id: string): id is LaunchAppId {
	return launchAppIds.includes(id as LaunchAppId);
}

export function isEditorAppId(id: string): id is EditorAppId {
	return editorAppIds.includes(id as EditorAppId);
}

export function isTerminalAppId(id: string): id is TerminalAppId {
	return terminalAppIds.includes(id as TerminalAppId);
}

export const appControlIds = ["github-desktop", "editor", "terminal"] as const;
export const staticControlIds = ["pr-status"] as const;

export type AppControlId = (typeof appControlIds)[number];
type StaticControlId = (typeof staticControlIds)[number];
export type ControlId = AppControlId | StaticControlId;

interface ControlOptionField {
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
