import { join } from "@tauri-apps/api/path";

function isWindowsPlatform() {
	return /win/i.test(`${navigator.platform} ${navigator.userAgent}`);
}

export function getDefaultTerminalShell() {
	return isWindowsPlatform() ? "powershell.exe -NoLogo -NoProfile" : "/bin/zsh";
}

export const DEFAULT_TERMINAL_SHELL = getDefaultTerminalShell();

export interface GlobalTerminalTemplate {
	id: string;
	name: string;
	commands: string[];
}

export interface ProjectTerminalTemplate extends GlobalTerminalTemplate {
	cwd: string;
}

export interface ResolvedTerminalTemplate {
	id: string;
	name: string;
	cwd: string;
	commands: string[];
	scope: "global" | "project";
	displayCwd: string | null;
}

export interface GlobalTerminalTemplateDraft {
	id: string;
	name: string;
	commandsText: string;
}

export interface ProjectTerminalTemplateDraft
	extends GlobalTerminalTemplateDraft {
	cwd: string;
}

function createTemplateId() {
	return crypto.randomUUID();
}

export function commandsToText(commands: string[]) {
	return commands.join("\n");
}

export function textToCommands(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export function commandPreview(commandsText: string): string {
	const lines = commandsText
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length === 0) return "";
	if (lines.length === 1) return lines[0];
	return `${lines[0]} +${lines.length - 1}`;
}

export function createEmptyGlobalTerminalTemplateDraft(): GlobalTerminalTemplateDraft {
	return {
		id: createTemplateId(),
		name: "",
		commandsText: "",
	};
}

export function createEmptyProjectTerminalTemplateDraft(): ProjectTerminalTemplateDraft {
	return {
		...createEmptyGlobalTerminalTemplateDraft(),
		cwd: "",
	};
}

export function toGlobalTerminalTemplateDraft(
	template: GlobalTerminalTemplate,
): GlobalTerminalTemplateDraft {
	return {
		id: template.id,
		name: template.name,
		commandsText: commandsToText(template.commands),
	};
}

export function toProjectTerminalTemplateDraft(
	template: ProjectTerminalTemplate,
): ProjectTerminalTemplateDraft {
	return {
		...toGlobalTerminalTemplateDraft(template),
		cwd: template.cwd,
	};
}

function normalizeTemplateName(name: string) {
	return name.trim();
}

export function normalizeGlobalTerminalTemplates(
	drafts: GlobalTerminalTemplateDraft[],
): GlobalTerminalTemplate[] {
	return drafts
		.map((draft) => ({
			id: draft.id || createTemplateId(),
			name: normalizeTemplateName(draft.name),
			commands: textToCommands(draft.commandsText),
		}))
		.filter((template) => template.name && template.commands.length > 0);
}

export function normalizeProjectTerminalTemplates(
	drafts: ProjectTerminalTemplateDraft[],
): ProjectTerminalTemplate[] {
	return drafts
		.map((draft) => ({
			id: draft.id || createTemplateId(),
			name: normalizeTemplateName(draft.name),
			cwd: draft.cwd.trim(),
			commands: textToCommands(draft.commandsText),
		}))
		.filter((template) => template.name && template.commands.length > 0);
}

export async function resolveProjectTerminalTemplate(
	template: ProjectTerminalTemplate,
	worktreePath: string,
): Promise<ResolvedTerminalTemplate> {
	const relativeCwd = template.cwd.trim();
	return {
		id: template.id,
		name: template.name,
		cwd: relativeCwd ? await join(worktreePath, relativeCwd) : worktreePath,
		commands: template.commands,
		scope: "project",
		displayCwd: relativeCwd || null,
	};
}

export function resolveGlobalTerminalTemplate(
	template: GlobalTerminalTemplate,
	worktreePath: string,
): ResolvedTerminalTemplate {
	return {
		id: template.id,
		name: template.name,
		cwd: worktreePath,
		commands: template.commands,
		scope: "global",
		displayCwd: null,
	};
}
